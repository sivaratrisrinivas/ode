// Drives the HOSTED app (`ODE_LIVE_URL` or the first argument, e.g. https://ode-nluc.onrender.com) as a judge would, against the
// real PayPal sandbox. Without `--spend` it only reads: /api/health must say every setting is in place and the page must load
// with no console errors. With `--spend` it also makes an Own Ode from seed/notes.txt (about 1.3k ElevenLabs credits and one of
// the day's 5 Own Ode places), logs in to the PayPal sandbox as the payer and pays the first friend $50, and fails unless the
// capture answers 200 with two lines unlocked. PayPal's own delivery status for the webhook is only in its dashboard: the script
// prints the newest PAYMENT.CAPTURE.COMPLETED event to look up there (Webhook Events, status Success).
// Needs, in the environment (run with `node --env-file=.env`): PAYPAL_BUYER_EMAIL and PAYPAL_BUYER_PASSWORD (the sandbox payer's
// login, never printed), and for the webhook line PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET. See docs/agents/run.md.
// Usage: node --env-file=.env scripts/drive-live.mjs [url] [--spend]
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchBrowser } from "./browser.mjs";

const spend = process.argv.includes("--spend");
const base = (process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? process.env.ODE_LIVE_URL ?? "").replace(/\/$/, "");
if (!base) {
  console.error("Name the hosted site: ODE_LIVE_URL or the first argument.");
  process.exit(1);
}
const { PAYPAL_BUYER_EMAIL: buyerEmail, PAYPAL_BUYER_PASSWORD: buyerPassword } = process.env;
if (spend && (!buyerEmail || !buyerPassword)) {
  console.error("--spend needs PAYPAL_BUYER_EMAIL and PAYPAL_BUYER_PASSWORD (the sandbox payer's login) in .env.");
  process.exit(1);
}

const started = Date.now();
const lap = (what) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)} s] ${what}`);

// Every setting the hosted service needs to take a payment is in place (the answers carry no values).
const health = await (await fetch(`${base}/api/health`)).json();
assert.ok(health.config, "/api/health reports no config: the deployed build is older than the readiness report");
const missing = Object.entries(health.config).filter(([name, ok]) => !ok && name !== "elevenlabs");
assert.deepEqual(missing, [], `the hosted service is missing settings: ${missing.map(([name]) => name).join(", ")} (Render, Environment)`);
lap("health ok, every setting in place");

const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 1500 } });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (message) => message.type() === "error" && problems.push(message.text().slice(0, 160)));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`${base}/`, { waitUntil: "load", timeout: 60_000 });
  // "Make my own Ode" is behind the landing page's "More"; the page is up once that is.
  await page.locator("details.ode-menu > summary").waitFor({ timeout: 30_000 });
  assert.deepEqual(problems, [], "the page logged console errors on load");
  lap("page loads with no console errors");

  if (!spend) {
    console.log("read-only checks passed (add --spend to make an Ode and pay a friend).");
  } else {
    const notes = await readFile(new URL("../seed/notes.txt", import.meta.url), "utf8");
    await page.locator("details.ode-menu > summary").click();
    await page.getByRole("button", { name: /Make my own Ode/ }).click();
    const frame = await (async () => {
      for (let tries = 0; tries < 20; tries++) {
        const found = page.frames().find((candidate) => candidate.url().includes("quiet"));
        if (found) return found;
        await page.waitForTimeout(250);
      }
      throw new Error("the payer's pane did not open");
    })();
    await frame.getByLabel("Your trip notes").fill(notes);
    await frame.getByRole("button", { name: "Build the ledger" }).click();
    await frame.getByRole("button", { name: "Write the lyrics" }).click({ timeout: 90_000 });
    await frame.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent === "Make the Ode" && !button.disabled), null, { timeout: 120_000 });
    await frame.getByRole("button", { name: "Make the Ode" }).click();
    await frame.getByText("Your Ode").first().waitFor({ timeout: 300_000 });
    lap("Own Ode made");

    const friend = "Tharun"; // the first friend in seed/notes.txt
    await frame.getByLabel(new RegExp(`Pay ${friend}`)).fill("50");
    const capture = page.waitForResponse((response) => response.url().endsWith("/api/payments/capture"), { timeout: 120_000 });
    const order = page.waitForResponse((response) => response.url().endsWith("/api/payments/orders"), { timeout: 30_000 });
    const [popup] = await Promise.all([
      context.waitForEvent("page", { timeout: 30_000 }),
      frame.frameLocator('iframe[name^="__zoid__paypal"]').first().locator("[role=link], [data-funding-source=paypal]").first().click(),
    ]);
    const orderResponse = await order;
    assert.equal(orderResponse.status(), 200, `creating the order answered ${orderResponse.status()}: ${(await orderResponse.text()).slice(0, 160)}`);
    await popup.locator("#email").fill(buyerEmail, { timeout: 30_000 });
    await popup.getByRole("button", { name: "Next" }).click();
    await popup.locator("#password").fill(buyerPassword, { timeout: 30_000 });
    await popup.getByRole("button", { name: /Log In/i }).click();
    await popup.getByRole("button", { name: /Complete Purchase|Pay Now|Continue/i }).first().click({ timeout: 60_000 });
    const captured = await capture;
    assert.equal(captured.status(), 200, `capture answered ${captured.status()}`);
    const result = await captured.json();
    assert.equal(result.amountRepaidCents, 5000, "the capture did not record $50");
    assert.ok(result.linesUnlocked >= 2, `paying $50 unlocked ${result.linesUnlocked} lines, not 2`);
    lap(`paid ${friend} $50: ${result.linesUnlocked} lines unlocked`);

    if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
      const api = "https://api-m.sandbox.paypal.com";
      const token = (await (await fetch(`${api}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" })).json()).access_token;
      const events = await (await fetch(`${api}/v1/notifications/webhooks-events?page_size=1&event_type=PAYMENT.CAPTURE.COMPLETED`, { headers: { Authorization: `Bearer ${token}` } })).json();
      const newest = events.events?.[0];
      console.log(newest ? `newest capture event: ${newest.id} at ${newest.create_time}: look it up in the PayPal dashboard (Webhook Events) and check its status is Success` : "PayPal lists no capture event yet: check the dashboard in a minute");
    }
  }
} finally {
  await browser.close();
}
