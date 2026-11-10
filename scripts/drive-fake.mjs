// Drives a running `npm run dev:fake` (PORT, default 3000) through the whole page: build the ledger, write the
// lyrics, make the Ode, open Tharun's private friend link in a second tab, pay Tharun $50. Prints the unlock banner,
// how long the friend's open tab took to show the unlock, and where playback was asked to start, and saves a
// screenshot of each tab (the friend's is saved beside it, as friend-<name>). See docs/agents/run.md. Usage: node scripts/drive-fake.mjs [screenshot.png]
import { chromium } from "/home/srinivas/.bun/install/cache/playwright-core@1.63.0@@@1/index.mjs";

const port = process.env.PORT ?? "3000";
const screenshot = process.argv[2] ?? "unlock.png";

const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 900, height: 1400 } });
const page = await context.newPage();
// The fake Ode's audio is 256 junk bytes, so nothing can be heard; record each play() request and where it started.
await page.addInitScript(() => {
  window.__plays = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    window.__plays.push(this.currentTime);
    return play.call(this).catch(() => {});
  };
});

try {
  await page.goto(`http://localhost:${port}`);
  await page.locator("textarea").fill("Trip notes: Tharun paid for the car, 390 dollars, split four ways.");
  await page.getByRole("button", { name: "Build the ledger" }).click();
  await page.getByRole("button", { name: "Write the lyrics" }).click();
  await page.getByRole("button", { name: "Make the Ode" }).click();
  await page.getByText("Your Ode").waitFor({ timeout: 30_000 });
  const link = await page.getByRole("link", { name: /Tharun.s private link/ }).getAttribute("href");
  const friend = await context.newPage();
  await friend.goto(`http://localhost:${port}${link}`);
  await friend.getByRole("heading", { name: "An Ode for Tharun" }).waitFor();
  console.log("friend sees:", await friend.getByLabel("Your money").innerText());

  await page.getByLabel(/Pay Tharun/).fill("50");
  await page.getByRole("button", { name: "Pay Tharun" }).click();
  const paidAt = Date.now();
  await friend.getByRole("status").waitFor();
  console.log(`friend's open tab showed the unlock after ${Date.now() - paidAt} ms:`, await friend.getByRole("status").innerText());
  console.log("friend sees:", await friend.getByLabel("Your money").innerText());
  await page.getByRole("status").waitFor();
  console.log("banner:", await page.getByRole("status").innerText());
  await page.waitForTimeout(500);
  await page.screenshot({ path: screenshot });
  await friend.screenshot({ path: `friend-${screenshot}` });
  console.log("play() asked to start at (s):", await page.evaluate(() => window.__plays));
} finally {
  await browser.close();
}
