import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { parseByteRange } from "./byte-range.ts";
import type { FriendAccounts } from "./friend-accounts.ts";
import { eventStream, friendViewJson, friendViewPath, linkOwner, withLocks, type UnknownLink } from "./friend-view.ts";
import { parseRowEdit, rowWarnings, type LedgerRow } from "./ledger.ts";
import { editLedgerRow, proposeLedger, type ProposeLedgerError, type StoredLedger } from "./ledger-service.ts";
import { createLedgerStore } from "./ledger-store.ts";
import { editLyricLine, writeLyrics, type WriteLyricsError } from "./lyrics-service.ts";
import { createLyricsStore } from "./lyrics-store.ts";
import { ODE_STEPS, parseRunId, type OdeFailure, type OdeStep, type RunId } from "./ode-run.ts";
import { createOdeMaker, type OdeStatus, type StartOdeError } from "./ode-service.ts";
import { createOdeStore } from "./ode-store.ts";
import { parseWebhookEvent } from "./paypal-webhook.ts";
import { createPaymentStore } from "./payment-store.ts";
import { createPayments, type CaptureError, type CreateOrderError, type FriendStanding } from "./payments.ts";
import { parseLineEdit, parseLineNumber, type LineSlot, type LyricLine, type Lyrics, type NoSuchLine } from "./lyrics.ts";
import type { Section } from "./ode.ts";
import type { OdeWorkflow, Ports, Sql } from "./ports.ts";
import { ok, type Result } from "./result.ts";
import * as TripNotes from "./trip-notes.ts";
import { visitorMiddleware, type VisitorEnv, type VisitorId } from "./visitor.ts";

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

function startFailure(error: StartOdeError): { status: 409 | 422 | 502; message: string } {
  switch (error._tag) {
    case "LedgerNotReady":
    case "LyricsFlagged":
      return { status: 422, message: error.message };
    case "OdeAlreadyMade":
      return { status: 409, message: error.message };
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
 * The Ode's sections for the payer's page: each verse says which of its lines are still locked and where its friend
 * stands. A friend with no standing has every line locked.
 */
function sectionsJson(sections: readonly Section[], standings: readonly FriendStanding[], tokens: ReadonlyMap<string, string>) {
  return sections.map((section) => {
    if (section.kind !== "verse") return section;
    const standing = standings.find((candidate) => candidate.friend === section.friend);
    return {
      ...section,
      lines: withLocks(section.lines, standing),
      payment: standing === undefined ? null : standingJson(standing),
      friendViewPath: friendViewPath(tokens.get(section.friend)),
    };
  });
}

/** The Ode's status as JSON; `sections` decides what each reader sees of a ready Ode, so the payer's and a friend's pages share the rest. */
function odeJson(status: OdeStatus, sections: (sections: readonly Section[]) => unknown) {
  switch (status._tag) {
    case "NotMade":
      return { status: "none" };
    case "Making":
      return { status: "making", steps: stepsJson(status.step) };
    case "Failed":
      return { status: "failed", error: makeFailureMessage(status.failure) };
    case "Ready":
      return { status: "ready", durationMs: status.ode.durationMs, audioUrl: "/api/ode/audio", sections: sections(status.ode.sections) };
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

/** A fresh run ID for each attempt to make the Ode. */
function newRunId(): RunId {
  const run = parseRunId(randomUUID());
  // Defect: randomUUID always returns a lower-case UUID.
  if (run._tag === "err") throw run.error;
  return run.value;
}

/**
 * The HTTP API: the one seam the tests and the browser both use.
 *
 * @param deps - The database, the external-service ports the API calls itself (Eleven Music is called only by
 *   the Workflow task), the Workflow that makes the Ode, the PayPal account that pays each friend, and the PayPal
 *   client ID the page loads PayPal's buttons with (undefined when none is configured).
 * @returns A Hono app serving `/api/*`. Every request it sees, the page's own included, is attributed to a visitor by
 *   cookie, and a first visit sets that cookie.
 */
export function createApi({
  sql,
  ports,
  workflow,
  friendAccounts,
  paypalClientId,
}: {
  sql: Sql;
  ports: Pick<Ports, "clock" | "claude" | "paypal">;
  workflow: OdeWorkflow;
  friendAccounts: FriendAccounts;
  paypalClientId: string | undefined;
}): Hono<VisitorEnv> {
  const api = new Hono<VisitorEnv>();
  api.use("*", visitorMiddleware);
  const store = createLedgerStore(sql);
  const lyricsStore = createLyricsStore(sql);
  const odeStore = createOdeStore(sql);
  const payments = createPayments({ ledger: store, store: createPaymentStore(sql), paypal: ports.paypal, accounts: friendAccounts });
  const odeMaker = createOdeMaker({ clock: ports.clock, ledger: store, lyrics: lyricsStore, odes: odeStore, runs: odeStore, workflow, newRunId });

  api.get("/api/health", (c) => c.json({ ok: true, now: ports.clock.now().toISOString() }));

  api.get("/api/ledger", async (c) => c.json(ledgerJson(await store.read(), await store.linkTokens())));

  api.post("/api/ledger", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const notes = TripNotes.parse(field(body, "notes"));
    if (notes._tag === "err") return c.json({ error: notes.error.message }, 422);

    const result = await proposeLedger({ claude: ports.claude, store }, notes.value);
    if (result._tag === "err") {
      const { status, message } = proposeFailure(result.error);
      return c.json({ error: message }, status);
    }
    return c.json(ledgerJson(result.value, await store.linkTokens()));
  });

  api.patch("/api/ledger/:friend", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const edit = parseRowEdit(body);
    if (edit._tag === "err") return c.json({ error: edit.error.message }, 422);

    const row = await editLedgerRow(store, c.req.param("friend"), edit.value);
    if (row._tag === "err") return c.json({ error: row.error.message }, 404);
    return c.json(rowJson(row.value, await store.linkTokens()));
  });

  api.get("/api/lyrics", async (c) => c.json(lyricsJson(await lyricsStore.read())));

  api.post("/api/lyrics", async (c) => {
    const result = await writeLyrics({ claude: ports.claude, ledger: store, store: lyricsStore });
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

    const line = await editLyricLine(lyricsStore, slot.value, edit.value);
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

  /** The Ode as the payer's page sees it: each verse with its friend's standing and private link. */
  async function payerOde(status: OdeStatus, visitor: VisitorId) {
    const [standings, tokens] = await Promise.all([payments.standings(visitor), store.linkTokens()]);
    return odeJson(status, (sections) => sectionsJson(sections, standings, tokens));
  }

  api.get("/api/ode", async (c) => c.json(await payerOde(await odeMaker.status(), c.get("visitor"))));

  api.post("/api/ode", async (c) => {
    const started = await odeMaker.start();
    if (started._tag === "err") {
      const { status, message } = startFailure(started.error);
      return c.json({ error: message }, status);
    }
    return c.json(await payerOde(started.value, c.get("visitor")), 202);
  });

  // The client ID is public by design: PayPal's page script needs it. Null means the page offers its keyless Pay button.
  api.get("/api/config", (c) => c.json({ paypalClientId: paypalClientId ?? null }));

  api.post("/api/payments/orders", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const friend = field(body, "friend");
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

    const confirmed = await payments.confirm(event.value);
    if (confirmed._tag === "err") {
      // PayPal delivers again after a failure, and nothing was counted.
      console.error(`confirming a captured payment failed (${confirmed.error._tag}):`, confirmed.error);
      return c.json({ error: "Couldn't reach PayPal just now." }, 502);
    }
    return c.json({ ok: true });
  });

  /** What a friend's page shows right now, or `UnknownLink` when the token is nobody's. */
  async function friendView(token: string, visitor: VisitorId): Promise<Result<ReturnType<typeof friendViewJson>, UnknownLink>> {
    const friend = linkOwner(await store.friendForToken(token));
    if (friend._tag === "err") return friend;
    const [status, standings] = await Promise.all([odeMaker.status(), payments.standings(visitor)]);
    return ok(friendViewJson(friend.value, standings, (sections) => odeJson(status, sections)));
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

  // "Reset demo": the visitor's copy goes back to unpaid, for a retake. The Ode itself, its audio and every other
  // visitor's copy are untouched.
  api.post("/api/demo/reset", async (c) => {
    await payments.reset(c.get("visitor"));
    return c.json({ ok: true });
  });

  api.get("/api/ode/audio", async (c) => {
    const audio = await odeStore.readAudio();
    if (audio === undefined) return c.json({ error: "There is no Ode to play yet." }, 404);

    const headers = { "content-type": "audio/mpeg", "accept-ranges": "bytes" };
    const range = parseByteRange(c.req.header("range"), audio.byteLength);
    if (range._tag === "err") return c.body(null, 416, { ...headers, "content-range": `bytes */${audio.byteLength}` });
    // A copy, because a response body must be backed by a plain ArrayBuffer and the database's bytes may not be.
    if (range.value === undefined) return c.body(new Uint8Array(audio), 200, { ...headers, "content-length": String(audio.byteLength) });

    const { start, end } = range.value;
    return c.body(new Uint8Array(audio.subarray(start, end + 1)), 206, {
      ...headers,
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${audio.byteLength}`,
    });
  });

  // Unknown API paths must not fall through to the SPA's index.html.
  api.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  return api;
}
