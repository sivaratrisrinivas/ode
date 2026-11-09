import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import pg from "pg";
import { createApi } from "./app.ts";
import { createAnthropicClaude } from "./claude.ts";
import { createElevenMusic } from "./eleven-music.ts";
import type { Sql } from "./ports.ts";
import { migrate } from "./schema.ts";
import { unwiredClaude, unwiredMusic, unwiredPayPal } from "./unwired.ts";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

// Add ?sslmode=require to the URL for Render's external connection string.
const pool = new pg.Pool({ connectionString: databaseUrl });
const sql: Sql = {
  query: (text, params) => pool.query(text, params),
  async transaction(work) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  },
};
await migrate(sql);

const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
if (!anthropicApiKey) console.warn("ANTHROPIC_API_KEY is not set; turning trip notes into a ledger will fail.");

const elevenLabsApiKey = process.env["ELEVENLABS_API_KEY"];
if (!elevenLabsApiKey) console.warn("ELEVENLABS_API_KEY is not set; making the Ode will fail.");

const api = createApi({
  sql,
  ports: {
    clock: { now: () => new Date() },
    claude: anthropicApiKey ? createAnthropicClaude(anthropicApiKey) : unwiredClaude,
    music: elevenLabsApiKey ? createElevenMusic({ apiKey: elevenLabsApiKey }) : unwiredMusic,
    paypal: unwiredPayPal,
  },
});

const app = new Hono();
app.route("/", api);
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

const port = Number(process.env["PORT"] ?? 3000);
if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT is not a valid port: ${process.env["PORT"]}`);
serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`ode listening on :${port}`);
});
