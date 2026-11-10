import { PGlite } from "@electric-sql/pglite";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { seedExtraction, seedFriendAccounts, seedLyrics } from "../../test/seed.ts";
import { createApi } from "../server/app.ts";
import { friendAccounts } from "../server/friend-accounts.ts";
import { createOdeJob } from "../server/ode-job.ts";
import type { Sql } from "../server/ports.ts";
import { migrate } from "../server/schema.ts";
import { fakeClaudeByTask, fakeMusic, fakePorts, fakeWorkflow } from "./fakes.ts";

/**
 * The whole app with no keys: the real API and built page over in-process Postgres, with the test fakes for Claude
 * and Eleven Music. Run `npm run dev:fake`, open http://localhost:3000. State lives in memory and ends with the process.
 *
 * Set `FAKE_FLAGGED=1` to have Claude write Sahiti's line 1 with an amount that no rewrite fixes, so the page
 * shows a flagged line.
 */
const db = await PGlite.create();
const sql: Sql = {
  query: (text, params) => db.query(text, params),
  transaction: (work) => db.transaction((tx) => work(tx)),
};
await migrate(sql);

const written = structuredClone(seedLyrics);
if (process.env["FAKE_FLAGGED"] === "1") {
  const sahiti = written.friends.find((friend) => friend.name === "Sahiti");
  if (sahiti) sahiti.lines[0] = "Sahiti screamed at the gator for ninety bucks";
}
const claude = fakeClaudeByTask({
  "extract-ledger": () => seedExtraction,
  "write-lyrics": () => written,
  "rewrite-line": (input) => {
    const request: { line: string } = JSON.parse(input);
    return { line: request.line.replace("ninety", "fifty") };
  },
});
const music = fakeMusic();
const ports = { ...fakePorts(), claude, music };
const api = createApi({
  sql,
  ports,
  workflow: fakeWorkflow(createOdeJob({ sql, claude, music })),
  friendAccounts: friendAccounts(seedFriendAccounts),
  paypalClientId: undefined,
});

const app = new Hono();
app.route("/", api);
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

const port = Number(process.env["PORT"] ?? 3000);
serve({ fetch: app.fetch, port }, ({ port }) => console.log(`ode (fakes) listening on :${port}`));
