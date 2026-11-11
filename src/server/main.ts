import { readFileSync } from "node:fs";
import { Render } from "@renderinc/sdk";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import pg from "pg";
import { createApi } from "./app.ts";
import { createAnthropicClaude } from "./claude.ts";
import { createElevenMusic } from "./eleven-music.ts";
import { parseFriendAccounts } from "./friend-accounts.ts";
import { createInProcessWorkflow } from "./in-process-workflow.ts";
import { createOdeJob } from "./ode-job.ts";
import { createPayPal } from "./paypal.ts";
import type { Claude, OdeWorkflow, PayPal } from "./ports.ts";
import { createPostgresSql } from "./postgres.ts";
import { Redacted } from "./redacted.ts";
import { createRenderWorkflow } from "./render-workflow.ts";
import { migrate } from "./schema.ts";
import { unwiredClaude, unwiredMusic, unwiredPayPal } from "./unwired.ts";
import { parseWorkflowConfig, type WorkflowChoice } from "./workflow-config.ts";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

// Parsed before anything connects. Half-configured, or unconfigured on Render: startup ends with a message that names
// the variables, never their values. A deploy that cannot start the Workflow then fails, and Render keeps serving the
// previous deploy.
const workflowChoice = parseWorkflowConfig(process.env);
if (workflowChoice._tag === "err") throw workflowChoice.error;

// Add ?sslmode=require to the URL for Render's external connection string.
const pool = new pg.Pool({ connectionString: databaseUrl });
const sql = createPostgresSql(pool);
await migrate(sql);

const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
if (!anthropicApiKey) console.warn("ANTHROPIC_API_KEY is not set; turning trip notes into a ledger will fail.");
const claude: Claude = anthropicApiKey ? createAnthropicClaude(anthropicApiKey) : unwiredClaude;

/** The Ode is made by a Render Workflow task; only off Render, with nothing configured, does this process make it. */
function createWorkflow(choice: WorkflowChoice): OdeWorkflow {
  if (choice._tag === "Render") {
    console.log(`making the Ode runs as a task of the Render Workflow ${choice.workflowSlug}`);
    return createRenderWorkflow({
      tasks: new Render({ token: Redacted.reveal(choice.apiKey) }).workflows,
      workflowSlug: choice.workflowSlug,
    });
  }

  console.warn("RENDER_API_KEY and ODE_WORKFLOW_SLUG are not set; making the Ode runs inside this process, not as a Render Workflow task.");
  const elevenLabsApiKey = process.env["ELEVENLABS_API_KEY"];
  if (!elevenLabsApiKey) console.warn("ELEVENLABS_API_KEY is not set; making the Ode will fail.");
  const music = elevenLabsApiKey ? createElevenMusic({ apiKey: elevenLabsApiKey }) : unwiredMusic;
  return createInProcessWorkflow(createOdeJob({ sql, claude, music }));
}

const accounts = parseFriendAccounts(process.env["FRIEND_PAYPAL_ACCOUNTS"]);
if (accounts._tag === "err") throw accounts.error;
if (!process.env["FRIEND_PAYPAL_ACCOUNTS"]) console.warn("FRIEND_PAYPAL_ACCOUNTS is not set; paying a friend will fail.");

const paypalClientId = process.env["PAYPAL_CLIENT_ID"];
const paypalClientSecret = process.env["PAYPAL_CLIENT_SECRET"];
const paypalEnv = process.env["PAYPAL_ENV"] ?? "sandbox";
if (paypalEnv !== "sandbox" && paypalEnv !== "live") throw new Error(`PAYPAL_ENV must be sandbox or live, not ${paypalEnv}`);
const paypalWebhookId = process.env["PAYPAL_WEBHOOK_ID"];
if (!paypalWebhookId) console.warn("PAYPAL_WEBHOOK_ID is not set; PayPal's payment webhooks will be rejected and only capture responses unlock lines.");
if (!paypalClientId || !paypalClientSecret) console.warn("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set; paying a friend will fail.");
const paypal: PayPal = paypalClientId && paypalClientSecret ? createPayPal({ clientId: paypalClientId, clientSecret: paypalClientSecret, env: paypalEnv, ...(paypalWebhookId ? { webhookId: paypalWebhookId } : {}) }) : unwiredPayPal;

/** The built page, which a verse share's link-preview tags are put into; without a build the share page is served bare. */
function builtIndexHtml(): string | undefined {
  try {
    return readFileSync("./dist/index.html", "utf8");
  } catch {
    console.warn("dist/index.html is not built; verse share pages will have no app to load. Run `npm run build`.");
    return undefined;
  }
}

const indexHtml = builtIndexHtml();
const api = createApi({
  sql,
  ports: { clock: { now: () => new Date() }, claude, paypal },
  workflow: createWorkflow(workflowChoice.value),
  friendAccounts: accounts.value,
  paypalClientId: paypalClientSecret ? paypalClientId : undefined,
  ...(indexHtml === undefined ? {} : { indexHtml }),
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
