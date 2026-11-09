import { PGlite } from "@electric-sql/pglite";
import { createApi } from "../src/server/app.ts";
import type { Claude, ElevenMusic, Sql } from "../src/server/ports.ts";
import { migrate } from "../src/server/schema.ts";
import { fakePorts } from "../src/testing/fakes.ts";

// PGlite takes ~5 s to boot, so each test file boots one and every harness
// resets it. Tests within a file run sequentially, so sharing is safe.
let shared: Promise<PGlite> | undefined;

async function freshDatabase(): Promise<Sql> {
  shared ??= PGlite.create();
  const db = await shared;
  await db.exec("drop schema public cascade; create schema public;");
  const sql: Sql = {
    query: (text, params) => db.query(text, params),
    transaction: (work) => db.transaction((tx) => work(tx)),
  };
  await migrate(sql);
  return sql;
}

/** The test seam: the HTTP API, with in-process Postgres and fakes at the four ports. */
export async function createHarness(canned: { claude?: Claude; music?: ElevenMusic } = {}) {
  const sql = await freshDatabase();
  const ports = { ...fakePorts(), ...canned };
  const api = createApi({ sql, ports });

  return {
    ...ports,
    request: (path: string, init?: RequestInit) => api.request(path, init),
    get: (path: string) => api.request(path),
    post: (path: string, body: unknown, headers: Record<string, string> = {}) =>
      api.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    patch: (path: string, body: unknown) =>
      api.request(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}
