import { PGlite } from "@electric-sql/pglite";
import { createApi } from "../src/server/app.ts";
import { friendAccounts } from "../src/server/friend-accounts.ts";
import { createOdeJob } from "../src/server/ode-job.ts";
import type { Claude, ElevenMusic, Sql } from "../src/server/ports.ts";
import { migrate } from "../src/server/schema.ts";
import { fakePorts, fakeWorkflow } from "../src/testing/fakes.ts";
import { seedFriendAccounts } from "./seed.ts";

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

/**
 * The test seam: the HTTP API, with in-process Postgres and fakes at the four ports and at the Workflow.
 * The fake Workflow runs the Render task's job with its own database stores, as a separate process would.
 */
export async function createHarness(canned: { claude?: Claude; music?: ElevenMusic } = {}) {
  const sql = await freshDatabase();
  const ports = { ...fakePorts(), ...canned };
  const workflow = fakeWorkflow(createOdeJob({ sql, claude: ports.claude, music: ports.music }));

  /** A web service process: a new API over the same database and Workflow, as after a deploy or a crash. */
  function webService() {
    const api = createApi({ sql, ports, workflow, friendAccounts: friendAccounts(seedFriendAccounts), paypalClientId: undefined });
    return {
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

  return { ...ports, workflow, ...webService(), restartWebService: webService };
}

/**
 * Poll `read` until `done` accepts what it returned; the API is the only way to observe a
 * run that continues after its request has been answered.
 *
 * @param read - Fetches the current state through the API.
 * @param done - True once the state is the one the test waits for.
 * @returns The state that satisfied `done`; throws after 10 s so a stuck run fails the test.
 */
export async function pollUntil<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`gave up waiting; last state: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
