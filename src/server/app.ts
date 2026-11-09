import { Hono, type Context } from "hono";
import { parseRowEdit, rowWarnings, type LedgerRow } from "./ledger.ts";
import { editLedgerRow, proposeLedger, type ProposeLedgerError, type StoredLedger } from "./ledger-service.ts";
import { createLedgerStore } from "./ledger-store.ts";
import { editLyricLine, writeLyrics, type WriteLyricsError } from "./lyrics-service.ts";
import { createLyricsStore } from "./lyrics-store.ts";
import { parseLineEdit, parseLineNumber, type LineSlot, type LyricLine, type Lyrics, type NoSuchLine } from "./lyrics.ts";
import type { Ports, Sql } from "./ports.ts";
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

/**
 * The HTTP API: the one seam the tests and the browser both use.
 *
 * @param deps - The database and the four external-service ports.
 * @returns A Hono app serving `/api/*`.
 */
export function createApi({ sql, ports }: { sql: Sql; ports: Ports }): Hono {
  const api = new Hono();
  const store = createLedgerStore(sql);
  const lyricsStore = createLyricsStore(sql);

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

  // Unknown API paths must not fall through to the SPA's index.html.
  api.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  return api;
}
