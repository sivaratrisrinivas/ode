import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { parseByteRange } from "./byte-range.ts";
import { parseRowEdit, rowWarnings, type LedgerRow } from "./ledger.ts";
import { editLedgerRow, proposeLedger, type ProposeLedgerError, type StoredLedger } from "./ledger-service.ts";
import { createLedgerStore } from "./ledger-store.ts";
import { editLyricLine, writeLyrics, type WriteLyricsError } from "./lyrics-service.ts";
import { createLyricsStore } from "./lyrics-store.ts";
import { ODE_STEPS, parseRunId, type OdeFailure, type OdeStep, type RunId } from "./ode-run.ts";
import { createOdeMaker, type OdeStatus, type StartOdeError } from "./ode-service.ts";
import { createOdeStore } from "./ode-store.ts";
import { parseLineEdit, parseLineNumber, type LineSlot, type LyricLine, type Lyrics, type NoSuchLine } from "./lyrics.ts";
import type { OdeWorkflow, Ports, Sql } from "./ports.ts";
import { ok, type Result } from "./result.ts";
import * as TripNotes from "./trip-notes.ts";

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? Reflect.get(body, name) : undefined;
}

function rowJson(row: LedgerRow) {
  return {
    friend: row.friend,
    amountOwedCents: row.amountOwedCents,
    insideJoke: row.insideJoke,
    warnings: rowWarnings(row),
  };
}

function ledgerJson(ledger: StoredLedger) {
  return { notes: ledger.notes, warnings: ledger.warnings, rows: ledger.rows.map(rowJson) };
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

function odeJson(status: OdeStatus) {
  switch (status._tag) {
    case "NotMade":
      return { status: "none" };
    case "Making":
      return { status: "making", steps: stepsJson(status.step) };
    case "Failed":
      return { status: "failed", error: makeFailureMessage(status.failure) };
    case "Ready":
      return { status: "ready", durationMs: status.ode.durationMs, audioUrl: "/api/ode/audio", sections: status.ode.sections };
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
 *   the Workflow task), and the Workflow that makes the Ode.
 * @returns A Hono app serving `/api/*`.
 */
export function createApi({
  sql,
  ports,
  workflow,
}: {
  sql: Sql;
  ports: Pick<Ports, "clock" | "claude" | "paypal">;
  workflow: OdeWorkflow;
}): Hono {
  const api = new Hono();
  const store = createLedgerStore(sql);
  const lyricsStore = createLyricsStore(sql);
  const odeStore = createOdeStore(sql);
  const odeMaker = createOdeMaker({ clock: ports.clock, ledger: store, lyrics: lyricsStore, odes: odeStore, runs: odeStore, workflow, newRunId });

  api.get("/api/health", (c) => c.json({ ok: true, now: ports.clock.now().toISOString() }));

  api.get("/api/ledger", async (c) => c.json(ledgerJson(await store.read())));

  api.post("/api/ledger", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const notes = TripNotes.parse(field(body, "notes"));
    if (notes._tag === "err") return c.json({ error: notes.error.message }, 422);

    const result = await proposeLedger({ claude: ports.claude, store }, notes.value);
    if (result._tag === "err") {
      const { status, message } = proposeFailure(result.error);
      return c.json({ error: message }, status);
    }
    return c.json(ledgerJson(result.value));
  });

  api.patch("/api/ledger/:friend", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const edit = parseRowEdit(body);
    if (edit._tag === "err") return c.json({ error: edit.error.message }, 422);

    const row = await editLedgerRow(store, c.req.param("friend"), edit.value);
    if (row._tag === "err") return c.json({ error: row.error.message }, 404);
    return c.json(rowJson(row.value));
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

  async function editLine(c: Context, slot: Result<LineSlot, NoSuchLine>) {
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

  api.get("/api/ode", async (c) => c.json(odeJson(await odeMaker.status())));

  api.post("/api/ode", async (c) => {
    const started = await odeMaker.start();
    if (started._tag === "err") {
      const { status, message } = startFailure(started.error);
      return c.json({ error: message }, status);
    }
    return c.json(odeJson(started.value), 202);
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
