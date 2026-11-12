import { Hono, type Context } from "hono";
import { audioResponse } from "./audio-response.ts";
import { pairedInOrder, type FriendAccounts } from "./friend-accounts.ts";
import { eventStream, friendViewJson, friendViewPath, linkOwner, lockedSections, type UnknownLink } from "./friend-view.ts";
import { parseRowEdit, rowWarnings, type LedgerRow } from "./ledger.ts";
import { editLedgerRow, proposeLedger, type LedgerStore, type ProposeLedgerError, type StoredLedger } from "./ledger-service.ts";
import { createJudgeOdes } from "./judge-odes.ts";
import { createLedgerStore, findLinkHolder } from "./ledger-store.ts";
import { editLyricLine, writeLyrics, type LyricsStore, type WriteLyricsError } from "./lyrics-service.ts";
import { createLyricsStore } from "./lyrics-store.ts";
import { policyOf, SEEDED, type Owner, type OwnerPolicy } from "./owner.ts";
import { newRunId, ODE_STEPS, type OdeFailure, type OdeStep } from "./ode-run.ts";
import { createOdeMaker, type OdeMaker, type OdeRuns, type OdeStatus, type OdeStore, type StartOdeError } from "./ode-service.ts";
import { createOdeStore } from "./ode-store.ts";
import { parseWebhookEvent } from "./paypal-webhook.ts";
import { createPaymentStore, findOrderOwner } from "./payment-store.ts";
import { createPayments, type CaptureError, type CreateOrderError, type FriendStanding, type Payments } from "./payments.ts";
import { parseLineEdit, parseLineNumber, type LineSlot, type LyricLine, type Lyrics, type NoSuchLine } from "./lyrics.ts";
import type { Section } from "./ode.ts";
import type { OdeWorkflow, Ports, Sql } from "./ports.ts";
import { ok, type Result } from "./result.ts";
import * as TripNotes from "./trip-notes.ts";
import { BARE_SHELL } from "./share-page.ts";
import { chorusDropped, releaseStatus } from "./unlock.ts";
import { createVerseShareStore } from "./verse-share-store.ts";
import { mountVerseShares } from "./verse-share-routes.ts";
import { visitorMiddleware, type VisitorEnv } from "./visitor.ts";
import type { VisitorId } from "./visitor-id.ts";

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? Reflect.get(body, name) : undefined;
}

/** A ledger row for the payer, with the friend's private page to share. */
function rowJson(row: LedgerRow, tokens: ReadonlyMap<string, string>) {
  return {
    friend: row.friend,
    amountOwedCents: row.amountOwedCents,
    insideJoke: row.insideJoke,
    warnings: rowWarnings(row),
    friendViewPath: friendViewPath(tokens.get(row.friend)),
  };
}

function ledgerJson(ledger: StoredLedger, tokens: ReadonlyMap<string, string>) {
  return { notes: ledger.notes, warnings: ledger.warnings, rows: ledger.rows.map((row) => rowJson(row, tokens)) };
}

function lineJson(line: LyricLine) {
  return { text: line.text, problems: line.problems };
}

function lyricsJson(lyrics: Lyrics | undefined) {
  if (lyrics === undefined) return { verses: [], hook: null, chorus: null };
  return {
    verses: lyrics.verses.map((verse) => ({ friend: verse.friend, lines: verse.lines.map(lineJson) })),
    hook: lineJson(lyrics.hook),
    chorus: lineJson(lyrics.chorus),
  };
}

function proposeFailure(error: ProposeLedgerError): { status: 422 | 502; message: string } {
  switch (error._tag) {
    case "TooManyFriends":
      return { status: 422, message: error.message };
    case "ClaudeUnavailable":
    case "MalformedExtraction":
      // The payer gets a retry message; the operator needs the cause.
      console.error(`ledger extraction failed (${error._tag}):`, error);
      return { status: 502, message: "Couldn't read your trip notes just now. Try again in a moment." };
  }
}

function writeFailure(error: WriteLyricsError): { status: 422 | 502; message: string } {
  switch (error._tag) {
    case "LedgerNotReady":
      return { status: 422, message: error.message };
    case "ClaudeUnavailable":
    case "MalformedLyrics":
      console.error(`lyric writing failed (${error._tag}):`, error);
      return { status: 502, message: "Couldn't write your lyrics just now. Try again in a moment." };
  }
}

/** What the payer is told when a run did not produce an Ode. Nothing was saved in any of these cases. */
function makeFailureMessage(failure: OdeFailure): string {
  switch (failure._tag) {
    case "LedgerNotReady":
      return failure.message;
    case "ClaudeUnavailable":
    case "MalformedLyrics":
      return "Couldn't write your lyrics just now. Try again in a moment.";
    case "LyricsFlagged":
      return "Some lyric lines are flagged, so nothing was composed. Fix them in the lyrics preview, then make the Ode.";
    case "MusicUnavailable":
      return "Couldn't compose your Ode just now. Try again in a moment.";
    case "OdeRunCrashed":
    case "OdeRunLost":
      return "Something went wrong making your Ode. Try again in a moment.";
  }
}

function startFailure(error: StartOdeError): { status: 409 | 422 | 429 | 502; message: string } {
  switch (error._tag) {
    case "LedgerNotReady":
    case "LyricsFlagged":
    case "InvalidReleaseDate":
      return { status: 422, message: error.message };
    case "OdeAlreadyMade":
      return { status: 409, message: error.message };
    case "CapReached":
      return { status: 429, message: error.message };
    case "WorkflowUnavailable":
      // The payer gets a retry message; the operator needs the cause.
      console.error(`starting the Ode's Workflow run failed (${error._tag}):`, error);
      return { status: 502, message: "Couldn't start making your Ode just now. Try again in a moment." };
  }
}

/** Every step with where it stands: done, active or waiting. */
function stepsJson(current: OdeStep) {
  const at = ODE_STEPS.indexOf(current);
  return ODE_STEPS.map((name, index) => ({ name, state: index < at ? "done" : index === at ? "active" : "waiting" }));
}

function standingJson(standing: FriendStanding) {
  const { amountOwedCents, amountRepaidCents, linesUnlocked, nextLineAtCents, canPay } = standing;
  return { amountOwedCents, amountRepaidCents, linesUnlocked, nextLineAtCents, canPay };
}

/**
 * The Ode's sections for the payer's page: each verse says where its friend stands and carries the friend's private link.
 * A friend with no standing has every line locked.
 */
function sectionsJson(sections: readonly Section[], standings: readonly FriendStanding[], tokens: ReadonlyMap<string, string>) {
  return lockedSections(sections, standings, (verse, standing) => ({
    payment: standing === undefined ? null : standingJson(standing),
    friendViewPath: friendViewPath(tokens.get(verse.friend)),
  }));
}

/** What both pages' Ode shares: every friend's standing, what the trip is called, the time and where its audio is, read for one visitor's copy. */
interface OdeFinish {
  standings: readonly FriendStanding[];
  trip: string;
  now: Date;
  audioUrl: string;
}

/**
 * The Ode's status as JSON; `sections` decides what each reader sees of a ready Ode, so the payer's and a friend's pages share the
 * rest, including whether the chorus has dropped (`dropped`) and the trip it names.
 */
function odeJson(status: OdeStatus, finish: OdeFinish, sections: (sections: readonly Section[]) => unknown) {
  switch (status._tag) {
    case "NotMade":
      return { status: "none" };
    case "Making":
      return { status: "making", steps: stepsJson(status.step) };
    case "Failed":
      return { status: "failed", error: makeFailureMessage(status.failure) };
    case "Ready":
      return {
        status: "ready",
        durationMs: status.ode.durationMs,
        audioUrl: finish.audioUrl,
        trip: finish.trip,
        dropped: chorusDropped(finish.standings),
        release: status.releaseDate === undefined ? null : releaseStatus(status.releaseDate, finish.now, finish.standings),
        sections: sections(status.ode.sections),
      };
  }
}

function orderFailure(error: CreateOrderError): { status: 404 | 422 | 502; message: string } {
  switch (error._tag) {
    case "UnknownFriend":
      return { status: 404, message: error.message };
    case "NothingOwed":
    case "FullyRepaid":
    case "InvalidPayment":
    case "AmountTooHigh":
    case "NoPayPalAccount":
      return { status: 422, message: error.message };
    case "PayPalUnavailable":
      // The payer gets a retry message; the operator needs the cause.
      console.error(`creating the PayPal order failed (${error._tag}):`, error);
      return { status: 502, message: "Couldn't reach PayPal just now. Try again in a moment." };
  }
}

function captureFailure(error: CaptureError): { status: 402 | 422 | 502; message: string } {
  switch (error._tag) {
    case "PaymentDeclined":
      return { status: 402, message: error.message };
    case "NotAFriendsOrder":
    case "NothingOwed":
    case "FullyRepaid":
    case "AmountTooHigh":
      return { status: 422, message: error.message };
    case "PayPalUnavailable":
      console.error(`capturing the PayPal order failed (${error._tag}):`, error);
      return { status: 502, message: "Couldn't reach PayPal just now. Try again in a moment." };
  }
}

/** Everything the API reads and writes for one Ode: the Seeded Ode's, or one judge's. */
interface Scope {
  owner: Owner;
  policy: OwnerPolicy;
  ledger: LedgerStore;
  lyrics: LyricsStore;
  odes: OdeStore & OdeRuns;
  maker: OdeMaker;
  payments: Payments;
}

/**
 * The HTTP API: the one seam the tests and the browser both use.
 *
 * @param deps - The database, the external-service ports the API calls itself (Eleven Music is called only by
 *   the Workflow task), the Workflow that makes the Ode, the PayPal accounts that pay the friends, the PayPal
 *   client ID the page loads PayPal's buttons with (undefined when none is configured), and the built page's
 *   `index.html`, which a verse share's page carries its preview card in (a bare page when none is given).
 * @returns A Hono app serving `/api/*` and the verse share pages and cards under `/s/`. Every request it sees, the page's own
 *   included, is attributed to a visitor by cookie, and a first visit sets that cookie. A visitor works on the Seeded Ode
 *   until they start their own (`/api/judge-ode`), and then every request of theirs reads and writes their own Ode.
 */
export function createApi({
  sql,
  ports,
  workflow,
  friendAccounts,
  paypalClientId,
  indexHtml = BARE_SHELL,
}: {
  sql: Sql;
  ports: Pick<Ports, "clock" | "claude" | "paypal">;
  workflow: OdeWorkflow;
  friendAccounts: FriendAccounts;
  paypalClientId: string | undefined;
  indexHtml?: string;
}): Hono<VisitorEnv> {
  const api = new Hono<VisitorEnv>();
  api.use("*", visitorMiddleware);
  const judges = createJudgeOdes(sql, ports.clock);

  /** The stores and services for one owner's Ode. They hold no state, so one is built wherever it is needed. */
  function scopeFor(owner: Owner): Scope {
    const ledger = createLedgerStore(sql, owner);
    const lyrics = createLyricsStore(sql, owner);
    const odes = createOdeStore(sql, owner);
    const policy = policyOf(owner);
    const accounts = async () => (policy.friendsPaidByName ? friendAccounts : pairedInOrder(friendAccounts, (await ledger.read()).rows.map((row) => row.friend)));
    const payments = createPayments({ ledger, store: createPaymentStore(sql, owner), paypal: ports.paypal, accounts });
    const admit = policy.countsAgainstCap ? () => judges.claim(owner) : undefined;
    const maker = createOdeMaker({ clock: ports.clock, ledger, lyrics, odes, runs: odes, workflow, newRunId, ...(admit ? { admit } : {}) });
    return { owner, policy, ledger, lyrics, odes, maker, payments };
  }

  /** The Ode the visitor is working on: their own if they started one, else the Seeded Ode. */
  async function scopeOf(visitor: VisitorId): Promise<Scope> {
    return scopeFor((await judges.isJudge(visitor)) ? visitor : SEEDED);
  }

  api.get("/api/health", (c) => c.json({ ok: true, now: ports.clock.now().toISOString() }));

  api.get("/api/judge-ode", async (c) => c.json({ mine: await judges.isJudge(c.get("visitor")) }));

  // Start the visitor's own Ode. When the day's new Odes are used up they stay on the Seeded Ode, with the reason.
  api.post("/api/judge-ode", async (c) => {
    const entered = await judges.enter(c.get("visitor"));
    if (entered._tag === "err") return c.json({ error: entered.error.message }, 429);
    return c.json({ mine: true });
  });

  // Back to the Seeded Ode; the visitor's own Ode is forgotten.
  api.delete("/api/judge-ode", async (c) => {
    await judges.leave(c.get("visitor"));
    return c.json({ mine: false });
  });

  api.get("/api/ledger", async (c) => {
    const { ledger } = await scopeOf(c.get("visitor"));
    return c.json(ledgerJson(await ledger.read(), await ledger.linkTokens()));
  });

  api.post("/api/ledger", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const notes = TripNotes.parse(field(body, "notes"));
    if (notes._tag === "err") return c.json({ error: notes.error.message }, 422);

    const { ledger } = await scopeOf(c.get("visitor"));
    const result = await proposeLedger({ claude: ports.claude, store: ledger }, notes.value);
    if (result._tag === "err") {
      const { status, message } = proposeFailure(result.error);
      return c.json({ error: message }, status);
    }
    return c.json(ledgerJson(result.value, await ledger.linkTokens()));
  });

  api.patch("/api/ledger/:friend", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const edit = parseRowEdit(body);
    if (edit._tag === "err") return c.json({ error: edit.error.message }, 422);

    const { ledger } = await scopeOf(c.get("visitor"));
    const row = await editLedgerRow(ledger, c.req.param("friend"), edit.value);
    if (row._tag === "err") return c.json({ error: row.error.message }, 404);
    return c.json(rowJson(row.value, await ledger.linkTokens()));
  });

  api.get("/api/lyrics", async (c) => c.json(lyricsJson(await (await scopeOf(c.get("visitor"))).lyrics.read())));

  api.post("/api/lyrics", async (c) => {
    const { ledger, lyrics } = await scopeOf(c.get("visitor"));
    const result = await writeLyrics({ claude: ports.claude, ledger, store: lyrics });
    if (result._tag === "err") {
      const { status, message } = writeFailure(result.error);
      return c.json({ error: message }, status);
    }
    return c.json(lyricsJson(result.value));
  });

  async function editLine(c: Context<VisitorEnv>, slot: Result<LineSlot, NoSuchLine>) {
    if (slot._tag === "err") return c.json({ error: slot.error.message }, 404);
    const body: unknown = await c.req.json().catch(() => undefined);
    const edit = parseLineEdit(body);
    if (edit._tag === "err") return c.json({ error: edit.error.message }, 422);

    const { lyrics } = await scopeOf(c.get("visitor"));
    const line = await editLyricLine(lyrics, slot.value, edit.value);
    if (line._tag === "err") return c.json({ error: line.error.message }, 404);
    return c.json(lineJson(line.value));
  }

  api.patch("/api/lyrics/verses/:friend/lines/:line", (c) => {
    const friend = c.req.param("friend");
    const line = parseLineNumber(c.req.param("line"));
    return editLine(c, line._tag === "err" ? line : ok({ _tag: "verse", friend, line: line.value }));
  });
  api.patch("/api/lyrics/hook", (c) => editLine(c, ok({ _tag: "hook" })));
  api.patch("/api/lyrics/chorus", (c) => editLine(c, ok({ _tag: "chorus" })));

  /** The standings in the copy of `visitor`, the trip's name, the time and where the audio is, which both pages' Odes carry. */
  async function finishOf(scope: Scope, copy: VisitorId, audioUrl: string): Promise<OdeFinish> {
    const [standings, trip] = await Promise.all([scope.payments.standings(copy), scope.ledger.trip()]);
    return { standings, trip, now: ports.clock.now(), audioUrl };
  }

  /** The Ode as the payer's page sees it: each verse with its friend's standing and private link. */
  async function payerOde(scope: Scope, status: OdeStatus, visitor: VisitorId) {
    const [finish, tokens] = await Promise.all([finishOf(scope, visitor, "/api/ode/audio"), scope.ledger.linkTokens()]);
    return odeJson(status, finish, (sections) => sectionsJson(sections, finish.standings, tokens));
  }

  api.get("/api/ode", async (c) => {
    const scope = await scopeOf(c.get("visitor"));
    return c.json(await payerOde(scope, await scope.maker.status(), c.get("visitor")));
  });

  api.post("/api/ode", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const visitor = c.get("visitor");
    const scope = await scopeOf(visitor);
    const started = await scope.maker.start(field(body, "releaseDate"));
    if (started._tag === "err") {
      // The day's new Odes went while the judge was writing: nothing was made, and they are back on the Seeded Ode.
      if (started.error._tag === "CapReached") await judges.leave(visitor);
      const { status, message } = startFailure(started.error);
      return c.json({ error: message }, status);
    }
    return c.json(await payerOde(scope, started.value, visitor), 202);
  });

  // The client ID is public by design: PayPal's page script needs it. Null means the page offers its keyless Pay button.
  api.get("/api/config", (c) => c.json({ paypalClientId: paypalClientId ?? null }));

  api.post("/api/payments/orders", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const friend = field(body, "friend");
    const { payments } = await scopeOf(c.get("visitor"));
    const order = await payments.createOrder(c.get("visitor"), typeof friend === "string" ? friend : "", field(body, "amountCents"));
    if (order._tag === "err") {
      const { status, message } = orderFailure(order.error);
      return c.json({ error: message }, status);
    }
    return c.json({ orderId: order.value });
  });

  api.post("/api/payments/capture", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const orderId = field(body, "orderId");
    if (typeof orderId !== "string" || orderId === "") return c.json({ error: "Send the orderId PayPal gave you." }, 422);

    const { payments } = await scopeOf(c.get("visitor"));
    const paid = await payments.capture(c.get("visitor"), orderId);
    if (paid._tag === "err") {
      const { status, message } = captureFailure(paid.error);
      return c.json({ error: message }, status);
    }
    return c.json({ friend: paid.value.friend, ...standingJson(paid.value) });
  });

  // PayPal calls this, not the page: it carries no payer session, only PayPal's signature, which PayPal verifies.
  api.post("/api/payments/webhook", async (c) => {
    const body = await c.req.text();
    // Header names are lower-case here, as the port expects.
    if (!(await ports.paypal.verifyWebhook({ headers: Object.fromEntries(c.req.raw.headers), body }))) {
      return c.json({ error: "The webhook signature could not be verified." }, 401);
    }

    const event = parseWebhookEvent(body);
    if (event._tag === "err") return c.json({ error: event.error.message }, 422);
    if (event.value === "other") return c.json({ ok: true });

    // The event names only the order; the order says whose Ode the payment counts in. An order nobody made here counts nowhere.
    const owner = await findOrderOwner(sql, event.value.orderId);
    if (owner === undefined) return c.json({ ok: true });
    const confirmed = await scopeFor(owner).payments.confirm(event.value);
    if (confirmed._tag === "err") {
      // PayPal delivers again after a failure, and nothing was counted.
      console.error(`confirming a captured payment failed (${confirmed.error._tag}):`, confirmed.error);
      return c.json({ error: "Couldn't reach PayPal just now." }, 502);
    }
    return c.json({ ok: true });
  });

  /**
   * What a friend's page shows right now, or `UnknownLink` when the token is nobody's. The link says whose Ode it is, whoever
   * opens it: a judge's friend sees the judge's Ode and payments, while the Seeded Ode's friend page shows the viewer's own copy.
   */
  async function friendView(token: string, visitor: VisitorId): Promise<Result<ReturnType<typeof friendViewJson>, UnknownLink>> {
    const holder = linkOwner(await findLinkHolder(sql, token));
    if (holder._tag === "err") return holder;
    const { owner, friend } = holder.value;
    const scope = scopeFor(owner);
    const [status, finish] = await Promise.all([scope.maker.status(), finishOf(scope, scope.policy.copyOf(visitor), `/api/friends/${token}/audio`)]);
    return ok(friendViewJson(friend, finish.standings, status, (sections) => odeJson(status, finish, sections)));
  }

  api.get("/api/friends/:token", async (c) => {
    const view = await friendView(c.req.param("token"), c.get("visitor"));
    return view._tag === "err" ? c.json({ error: view.error.message }, 404) : c.json(view.value);
  });

  // Server-sent events: the whole view on connect and again whenever it changes, so a view that reconnects after a
  // drop is current without asking for anything.
  api.get("/api/friends/:token/events", async (c) => {
    const token = c.req.param("token");
    const visitor = c.get("visitor");
    const first = await friendView(token, visitor);
    return first._tag === "err" ? c.json({ error: first.error.message }, 404) : eventStream(first.value, () => friendView(token, visitor));
  });

  mountVerseShares(api, { holderOf: (token) => findLinkHolder(sql, token), scopeFor, shares: createVerseShareStore(sql), indexHtml });

  // "Reset demo": the visitor's copy goes back to unpaid, for a retake. The Ode itself, its audio and every other
  // visitor's copy are untouched.
  api.post("/api/demo/reset", async (c) => {
    const { payments } = await scopeOf(c.get("visitor"));
    await payments.reset(c.get("visitor"));
    return c.json({ ok: true });
  });

  api.get("/api/ode/audio", async (c) => audioResponse(c, await (await scopeOf(c.get("visitor"))).odes.readAudio()));

  // A friend's page plays the audio of the Ode their link belongs to.
  api.get("/api/friends/:token/audio", async (c) => {
    const holder = linkOwner(await findLinkHolder(sql, c.req.param("token")));
    if (holder._tag === "err") return c.json({ error: holder.error.message }, 404);
    return audioResponse(c, await scopeFor(holder.value.owner).odes.readAudio());
  });

  // Unknown API paths must not fall through to the SPA's index.html.
  api.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  return api;
}
