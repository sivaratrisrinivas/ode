import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import pg from "pg";
import { createApi } from "./app.ts";
import { migrate, seedSkeletonLedger } from "./schema.ts";
import { unwiredClaude, unwiredMusic, unwiredPayPal } from "./unwired.ts";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

// Add ?sslmode=require to the URL for Render's external connection string.
const sql = new pg.Pool({ connectionString: databaseUrl });
await migrate(sql);
await seedSkeletonLedger(sql);

const api = createApi({
  sql,
  ports: {
    clock: { now: () => new Date() },
    claude: unwiredClaude,
    music: unwiredMusic,
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
