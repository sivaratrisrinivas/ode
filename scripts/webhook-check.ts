import { readEnv } from "../src/ops/env.ts";
import { assessWebhooks, CAPTURE_EVENT, describeReport, parseWebhooks, WEBHOOK_PATH } from "../src/ops/webhook-check.ts";
import { field } from "../src/server/paypal.ts";

/**
 * The operator's check of PayPal's capture webhook (#4), against the PayPal SANDBOX only (the host is fixed; `PAYPAL_ENV=live`
 * is refused). It lists the sandbox app's webhooks and says whether `PAYPAL_WEBHOOK_ID` is the id of one of them (not its
 * URL), whether that webhook posts to `<app>/api/payments/webhook`, and whether it is subscribed to `PAYMENT.CAPTURE.COMPLETED`.
 *
 *   node --env-file=.env scripts/webhook-check.ts [--simulate]
 *
 * Read-only by default. `--simulate` also asks PayPal's simulator to send one `PAYMENT.CAPTURE.COMPLETED` to the webhook that
 * posts to the app's path; PayPal answers 202, and its simulated events carry a signature the app rejects (401), so that
 * proves PayPal accepts the subscription, not that the app verified it. It never edits `.env` and never prints a secret
 * or the value of `PAYPAL_WEBHOOK_ID`. Needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (and PAYPAL_WEBHOOK_ID to be judged).
 */
const HOST = "https://api-m.sandbox.paypal.com";
const simulate = process.argv.slice(2).includes("--simulate");

if (process.env["PAYPAL_ENV"] === "live") {
  console.error("PAYPAL_ENV is live: this script only talks to the PayPal sandbox. Run it with PAYPAL_ENV=sandbox.");
  process.exit(1);
}
const env = readEnv(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
// The one place this command ends on a missing variable: print which, and exit non-zero before calling PayPal.
if (env._tag === "err") {
  console.error(env.error.message);
  process.exit(1);
}

/** Say what PayPal answered (its status and error name), never the request, which carries the credentials. */
async function fail(what: string, res: Response): Promise<never> {
  const body: unknown = await res.json().catch(() => undefined);
  const name = field(body, "name") ?? field(body, "error");
  console.error(`${what}: PayPal answered ${res.status}${typeof name === "string" ? ` (${name})` : ""}`);
  process.exit(1);
}

const tokenRes = await fetch(`${HOST}/v1/oauth2/token`, {
  method: "POST",
  headers: { authorization: `Basic ${Buffer.from(`${env.value.PAYPAL_CLIENT_ID}:${env.value.PAYPAL_CLIENT_SECRET}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
if (!tokenRes.ok) await fail("getting a sandbox token", tokenRes);
const token = field(await tokenRes.json(), "access_token");
if (typeof token !== "string") {
  console.error("getting a sandbox token: PayPal's reply had no access_token");
  process.exit(1);
}
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const listRes = await fetch(`${HOST}/v1/notifications/webhooks`, { headers });
if (!listRes.ok) await fail("listing the sandbox webhooks", listRes);
const webhooks = parseWebhooks(await listRes.json());
const report = assessWebhooks(webhooks, process.env["PAYPAL_WEBHOOK_ID"]);
console.log("PayPal sandbox:");
for (const line of describeReport(report)) console.log(line);

if (simulate) {
  const target = report.webhooks.find((webhook) => webhook.id === process.env["PAYPAL_WEBHOOK_ID"] && webhook.urlEndsRight) ?? report.webhooks.find((webhook) => webhook.urlEndsRight);
  if (target === undefined) {
    console.error(`Not simulating: no webhook posts to ${WEBHOOK_PATH}.`);
    process.exit(1);
  }
  const res = await fetch(`${HOST}/v1/notifications/simulate-event`, { method: "POST", headers, body: JSON.stringify({ webhook_id: target.id, event_type: CAPTURE_EVENT }) });
  if (!res.ok) await fail("simulating the event", res);
  const sent = field(await res.json(), "id");
  console.log(`Simulated ${CAPTURE_EVENT} to webhook ${target.id}: PayPal answered ${res.status}${typeof sent === "string" ? `, event ${sent}` : ""}. The app answers a simulated event 401 by design.`);
}
process.exit(report.ready ? 0 : 2);
