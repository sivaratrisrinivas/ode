import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { createApi } from "../src/server/app.ts";
import { friendAccounts } from "../src/server/friend-accounts.ts";
import type { Sql } from "../src/server/ports.ts";
import { migrate } from "../src/server/schema.ts";
import { fakePorts, fakeWorkflow } from "../src/testing/fakes.ts";
import { migrateLegacy } from "./legacy-schema.ts";
import { seedFriendAccounts } from "./seed.ts";

async function json<T>(res: Response): Promise<T> {
  return res.json();
}

describe("a database from before judges could make their own Ode", () => {
  it("keeps its ledger, Ode and payments as the Seeded Ode, and runs migrate again without change", async () => {
    const db = await PGlite.create();
    const sql: Sql = { query: (text, params) => db.query(text, params), transaction: (work) => db.transaction((tx) => work(tx)) };
    await migrateLegacy(sql);
    await sql.query("insert into ledger (id, notes, trip, warnings) values (1, 'old notes', 'Florida ''25', '[]')");
    await sql.query(
      `insert into ledger_friends (friend, position, amount_owed_cents, amount_status, inside_joke, link_token)
       values ('Tharun', 0, 10000, 'stated', 'Drove all night', $1)`,
      ["a".repeat(64)],
    );
    for (const [index, text] of ["one", "two", "three", "four"].entries()) {
      await sql.query("insert into lyric_lines (friend, line_no, text) values ('Tharun', $1, $2)", [index + 1, text]);
    }
    await sql.query("insert into lyric_refrains (kind, text) values ('hook', 'hook'), ('chorus', 'chorus')");
    await sql.query("insert into odes (id, audio) values (1, $1)", [Uint8Array.from([1, 2, 3])]);
    await sql.query(
      `insert into ode_sections (position, kind, friend, text, start_ms, end_ms) values
         (0, 'intro', null, null, 0, 1000), (1, 'verse', 'Tharun', null, 1000, 5000),
         (2, 'hook', null, 'hook', 5000, 6000), (3, 'chorus', null, 'chorus', 6000, 7000)`,
    );
    for (let line = 1; line <= 4; line += 1) {
      await sql.query("insert into ode_lines (position, line_no, text, start_ms, end_ms) values (1, $1, 'x', $2, $3)", [line, 1000 + line * 900, 1900 + line * 900]);
    }
    const visitor = "11111111-2222-4333-8444-555555555555";
    await sql.query("insert into payments (capture_id, order_id, visitor, friend, amount_cents) values ('CAPTURE-1', 'ORDER-1', $1, 'Tharun', 5000)", [visitor]);
    await sql.query("insert into payment_orders (order_id, visitor) values ('ORDER-1', $1)", [visitor]);

    await migrate(sql);
    await migrate(sql);

    const ports = fakePorts();
    const api = createApi({
      sql,
      ports,
      workflow: fakeWorkflow(async () => "ready"),
      friendAccounts: friendAccounts(seedFriendAccounts),
      paypalClientId: undefined,
    });
    const asVisitor = (path: string) => api.request(path, { headers: { cookie: `ode_visitor=${visitor}` } });

    const ode = await json<{ status: string; trip: string; release: unknown; sections: { kind: string; payment?: { amountRepaidCents: number; linesUnlocked: number }; friendViewPath?: string }[] }>(
      await asVisitor("/api/ode"),
    );
    expect(ode.status).toBe("ready");
    expect(ode.trip).toBe("Florida '25");
    // Made before a release date was required, so it keeps having none: no countdown, never delayed.
    expect(ode.release).toBeNull();
    expect(ode.sections.find((section) => section.kind === "verse")?.payment).toMatchObject({ amountRepaidCents: 5_000, linesUnlocked: 2 });
    expect(ode.sections.find((section) => section.kind === "verse")?.friendViewPath).toBe(`/f/${"a".repeat(64)}`);
    expect((await asVisitor("/api/ode/audio")).status).toBe(200);
    expect((await json<{ mine: boolean }>(await asVisitor("/api/judge-ode"))).mine).toBe(false);
  });
});

describe("a database from before the Seeded Ode could be converted to the payer's voice", () => {
  it("reads its Seeded Ode as Eleven Music's, with no voice label, once migrate adds the voice column", async () => {
    const db = await PGlite.create();
    const sql: Sql = { query: (text, params) => db.query(text, params), transaction: (work) => db.transaction((tx) => work(tx)) };
    await migrate(sql);
    await sql.query("insert into ledger (owner, notes, trip) values ('seeded', 'notes', 'Florida ''25')");
    await sql.query(
      "insert into ledger_friends (owner, friend, position, amount_owed_cents, amount_status, inside_joke) values ('seeded', 'Tharun', 0, 10000, 'stated', 'Drove all night')",
    );
    await sql.query("insert into odes (owner, audio) values ('seeded', $1)", [Uint8Array.from([1, 2, 3])]);
    await sql.query(
      `insert into ode_sections (owner, position, kind, friend, text, start_ms, end_ms) values
         ('seeded', 0, 'intro', null, null, 0, 1000), ('seeded', 1, 'verse', 'Tharun', null, 1000, 5000)`,
    );
    for (let line = 1; line <= 4; line += 1) {
      await sql.query("insert into ode_lines (owner, position, line_no, text, start_ms, end_ms) values ('seeded', 1, $1, 'x', $2, $3)", [line, 1000 + line * 900, 1900 + line * 900]);
    }
    // The table as the version before #35 left it.
    await sql.query("alter table odes drop column voice");

    await migrate(sql);

    const api = createApi({ sql, ports: fakePorts(), workflow: fakeWorkflow(async () => "ready"), friendAccounts: friendAccounts(seedFriendAccounts), paypalClientId: undefined });
    const ode = await json<{ status: string; voiceLabel: string | null }>(await api.request("/api/ode"));
    expect(ode).toMatchObject({ status: "ready", voiceLabel: null });
  });
});
