import { PGlite } from "@electric-sql/pglite";
import { createApi } from "../src/server/app.ts";
import type { Claude, ElevenMusic } from "../src/server/ports.ts";
import { migrate, seedSkeletonLedger } from "../src/server/schema.ts";
import { fakePorts } from "../src/testing/fakes.ts";

// PGlite takes ~5 s to boot, so each test file boots one and every harness
// resets it. Tests within a file run sequentially, so sharing is safe.
let shared: Promise<PGlite> | undefined;

async function freshDatabase(): Promise<PGlite> {
  shared ??= PGlite.create();
  const db = await shared;
  await db.exec("drop schema public cascade; create schema public;");
  await migrate(db);
  await seedSkeletonLedger(db);
  return db;
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
  };
}
