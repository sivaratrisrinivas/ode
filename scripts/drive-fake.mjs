// Drives a running `npm run dev:fake` (PORT, default 3000) through the whole page: build the ledger, write the
// lyrics, make the Ode, pay Tharun $50. Prints the unlock banner and where playback was asked to start, and saves a
// screenshot. See docs/agents/run.md. Usage: node scripts/drive-fake.mjs [screenshot.png]
import { chromium } from "/home/srinivas/.bun/install/cache/playwright-core@1.63.0@@@1/index.mjs";

const port = process.env.PORT ?? "3000";
const screenshot = process.argv[2] ?? "unlock.png";

const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
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
  await page.getByLabel(/Pay Tharun/).fill("50");
  await page.getByRole("button", { name: "Pay Tharun" }).click();
  await page.getByRole("status").waitFor();
  console.log("banner:", await page.getByRole("status").innerText());
  await page.waitForTimeout(500);
  await page.screenshot({ path: screenshot });
  console.log("play() asked to start at (s):", await page.evaluate(() => window.__plays));
} finally {
  await browser.close();
}
