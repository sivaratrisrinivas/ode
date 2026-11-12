// Screenshots the 3D cassette, which scripts/drive-fake.mjs cannot check (it runs without WebGL). Against a running
// `npm run dev:fake` whose Ode is already made (run drive-fake.mjs first, or make one by hand), it forces the 3D scene on this
// browser's software WebGL (`localStorage["ode:3d"] = "force"`, see src/client/scene/quality.ts) and saves, into <outdir>:
// the payer's page, the landing page, the split screen, a friend's page at phone width and a verse share. The pages are slow here (a few
// frames a second); the pictures are for a person to look at, and nothing is asserted.
// Usage: PORT=3000 node scripts/shot-3d.mjs <outdir>
import { launchBrowser } from "./browser.mjs";

const port = process.env.PORT ?? "3000";
const out = process.argv[2] ?? ".";
const site = `http://localhost:${port}`;
const browser = await launchBrowser(["--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => localStorage.setItem("ode:3d", "force"));
const page = await context.newPage();
page.on("pageerror", (error) => console.log("page error:", error.message));

await page.goto(`${site}/payer`);
await page.getByText("Your Ode").waitFor({ timeout: 30_000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}/3d-payer.png` });

await page.goto(site);
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}/3d-landing.png` });

await page.goto(`${site}/split`);
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}/3d-split.png` });
const friendPath = await page.locator('iframe[title="Friend view"]').getAttribute("src");

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${site}${friendPath}`);
await page.waitForTimeout(5000);
await page.screenshot({ path: `${out}/3d-friend-phone.png` });

const share = page.getByRole("button", { name: "Share my verse" });
if ((await share.count()) > 0) {
  await share.click();
  const link = await page.getByLabel("Your share link").inputValue();
  await page.goto(link);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${out}/3d-share-phone.png` });
}
await browser.close();
