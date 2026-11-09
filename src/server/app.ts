import { Hono } from "hono";
import { parseRowEdit, rowWarnings, type LedgerRow } from "./ledger.ts";
import { editLedgerRow, proposeLedger, type ProposeLedgerError, type StoredLedger } from "./ledger-service.ts";
import { createLedgerStore } from "./ledger-store.ts";
import type { Ports, Sql } from "./ports.ts";
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

/**
 * The HTTP API: the one seam the tests and the browser both use.
 *
 * @param deps - The database and the four external-service ports.
 * @returns A Hono app serving `/api/*`.
 */
export function createApi({ sql, ports }: { sql: Sql; ports: Ports }): Hono {
  const api = new Hono();
  const store = createLedgerStore(sql);

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

  // Unknown API paths must not fall through to the SPA's index.html.
  api.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  return api;
}
