import { Hono } from "hono";
import type { Ports, Sql } from "./ports.ts";

interface LedgerRow {
  friend: string;
  amount_owed_cents: number;
  inside_joke: string;
}

export function createApi({ sql, ports }: { sql: Sql; ports: Ports }): Hono {
  const api = new Hono();

  api.get("/api/health", (c) => c.json({ ok: true, now: ports.clock.now().toISOString() }));

  api.get("/api/ledger", async (c) => {
    const { rows } = await sql.query<LedgerRow>(
      "select friend, amount_owed_cents, inside_joke from ledger_rows order by friend",
    );
    return c.json({
      rows: rows.map((r) => ({
        friend: r.friend,
        amountOwedCents: r.amount_owed_cents,
        insideJoke: r.inside_joke,
      })),
    });
  });

  // Unknown API paths must not fall through to the SPA's index.html.
  api.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  return api;
}
