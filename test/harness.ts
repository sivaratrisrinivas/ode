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

/** The request body that makes an Ode: the release date it needs, a date no test's clock reaches. */
export const MAKE_ODE = { releaseDate: "2027-01-01" };

/**
 * The test seam: the HTTP API, with in-process Postgres and fakes at the four ports and at the Workflow.
 * The fake Workflow runs the Render task's job with its own database stores, as a separate process would.
 */
export async function createHarness(canned: { claude?: Claude; music?: ElevenMusic } = {}) {
  const sql = await freshDatabase();
  const ports = { ...fakePorts(), ...canned };
  const workflow = fakeWorkflow(createOdeJob({ sql, claude: ports.claude, music: ports.music }));

  /** One person's browser: it keeps the cookies the API sets and sends them back, so its requests are one visitor. */
  function browserOn(api: ReturnType<typeof createApi>, cookies: Map<string, string>) {
    const request = async (path: string, init: RequestInit = {}) => {
      const jar = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      const headers = new Headers(init.headers);
      if (jar !== "") headers.set("cookie", jar);
      const res = await api.request(path, { ...init, headers });
      for (const line of res.headers.getSetCookie()) {
        const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
        const [name = "", value = ""] = pair.split("=");
        if (value === "" || attributes.includes("Max-Age=0")) cookies.delete(name);
        else cookies.set(name, value);
      }
      return res;
    };
    return {
      request,
      get: (path: string) => request(path),
      post: (path: string, body: unknown, headers: Record<string, string> = {}) =>
        request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }),
      patch: (path: string, body: unknown) =>
        request(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      /** The browser's cookies emptied, as when the visitor clears site data. */
      clearCookies: () => cookies.clear(),
      /** The value of a cookie this browser holds; undefined before its first visit. */
      cookie: (name: string) => cookies.get(name),
    };
  }

  // The harness's own browser keeps its cookies across web service restarts, as a person's does.
  const cookies = new Map<string, string>();

  /** A web service process: a new API over the same database and Workflow, as after a deploy or a crash. */
  function webService() {
    const api = createApi({ sql, ports, workflow, friendAccounts: friendAccounts(seedFriendAccounts), paypalClientId: undefined });
    return {
      ...browserOn(api, cookies),
      /** Another person's browser on this same web service: its own cookies, so its own visitor. */
      newBrowser: () => browserOn(api, new Map()),
      /** A request that carries no cookie and keeps none, as PayPal's webhook makes. */
      anonymous: (path: string, init?: RequestInit) => api.request(path, init),
    };
  }

  return { ...ports, sql, workflow, ...webService(), restartWebService: webService };
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
