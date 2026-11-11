// Drives a running `npm run dev:fake` (PORT, default 3000) through the whole page: build the ledger, write the
// lyrics, make the Ode, open Tharun's private friend link in a second tab, pay Tharun $50. Prints the unlock banner,
// how long the friend's open tab took to show the unlock, and where playback was asked to start, and saves a
// screenshot of each tab (the friend's is saved beside it, as friend-<name>). Then it opens /split, the payer's page
// beside a friend's, and checks that a payment on the left unlocks the line on the right, that the picker switches the
// right pane between the friends, that the chorus stays locked on both panes until every friend is fully repaid and then
// reads "Full Ode dropped · Florida '25", and that the panes stack on a phone. Last, a second browser context (its own
// cookie, so its own copy of the Ode) checks that payments, reloads, "Reset demo" and a cleared cookie act on one copy only.
// Then judges: "Make my own Ode" builds a two-friend Ode from the judge's own notes beside the untouched Seeded Ode, pays its
// first friend, and goes back; once five new Odes have started that day the sixth judge is told so and stays on the Seeded Ode.
// The release date is checked on both: the payer picks it at "Make the Ode", every pane reads "N of 3 friends · D days to
// drop", and moving the fake clock past it (dev-fake's /dev/clock/advance-days) turns it into "Delayed" with the chorus locked.
// See docs/agents/run.md. Usage: node scripts/drive-fake.mjs [screenshot.png]
import assert from "node:assert/strict";
// PLAYWRIGHT_CORE overrides where playwright-core is imported from (it is not in node_modules).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "/home/srinivas/.bun/install/cache/playwright-core@1.63.0@@@1/index.mjs");

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

// The fake clock's day, plus an offset, as the page's date input wants it: dev-fake's clock is fixed, so the driver reads it.
const fakeNow = new Date((await (await fetch(`http://localhost:${port}/api/health`)).json()).now);
const dayIso = (offset) => new Date(fakeNow.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

try {
  await page.goto(`http://localhost:${port}/payer`);
  await page.locator("textarea").fill("Trip notes: Tharun paid for the car, 390 dollars, split four ways.");
  await page.getByRole("button", { name: "Build the ledger" }).click();
  await page.getByRole("button", { name: "Write the lyrics" }).click();
  await page.getByLabel("Release date").fill(dayIso(22));
  await page.getByRole("button", { name: "Make the Ode" }).click();
  await page.getByText("Your Ode").waitFor({ timeout: 30_000 });
  assert.equal(await page.getByLabel("Release date").innerText(), "0 of 3 friends · 22 days to drop", "the payer's page does not show the countdown");
  const link = await page.getByRole("link", { name: /Tharun.s private link/ }).getAttribute("href");
  const friend = await context.newPage();
  await friend.goto(`http://localhost:${port}${link}`);
  await friend.getByRole("heading", { name: "An Ode for Tharun" }).waitFor();
  console.log("friend sees:", await friend.getByLabel("Your money").innerText());
  assert.equal(await friend.getByLabel("Release date").innerText(), "0 of 3 friends · 22 days to drop", "the friend's page does not show the countdown");
  console.log("release date: both pages read", JSON.stringify(await friend.getByLabel("Release date").innerText()));

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

  // Building the ledger again ends every friend's link; the open tab must stop showing the Ode, not keep it stale.
  await page.request.post(`http://localhost:${port}/api/ledger`, { data: { notes: "Trip notes: Tharun paid for the car, 390 dollars, split four ways." } });
  await friend.getByText(/link doesn.t work any more/).waitFor({ timeout: 15_000 });
  console.log("friend after the ledger was rebuilt:", await friend.locator("main").innerText());

  // The split screen: the payer's page on the left, a friend's view on the right. The ledger was just rebuilt, so the
  // left pane makes a new Ode first.
  await page.goto(`http://localhost:${port}/split`);
  const left = page.frameLocator('iframe[title="Payer"]');
  const right = page.frameLocator('iframe[title="Friend view"]');
  await left.getByRole("button", { name: "Write the lyrics" }).click();
  await left.getByLabel("Release date").fill(dayIso(10));
  await left.getByRole("button", { name: "Make the Ode" }).click();
  await left.getByText("Your Ode").waitFor({ timeout: 30_000 });
  await right.getByRole("heading", { name: "An Ode for Tharun" }).waitFor({ timeout: 15_000 });

  await left.getByLabel(/Pay Tharun/).fill("50");
  await left.getByRole("button", { name: "Pay Tharun" }).click();
  const splitPaidAt = Date.now();
  await right.getByRole("status").waitFor();
  const splitMs = Date.now() - splitPaidAt;
  console.log(`split screen: the right pane showed the unlock after ${splitMs} ms:`, await right.getByRole("status").innerText());
  // "Within ~1 s" of the payment, plus the payer's order and capture requests (see the first check above); a loaded machine gets room.
  assert.ok(splitMs < 2500, `the right pane took ${splitMs} ms to show the unlock`);

  // Only the friend's pane sings the unlock; the payer's pane stays quiet so the two do not play over each other.
  const playsIn = (match) => page.frames().find((frame) => match.test(frame.url()))?.evaluate(() => window.__plays);
  assert.deepEqual(await playsIn(/\/\?quiet/), [], "the payer's pane played the unlock");
  assert.ok(((await playsIn(/\/f\//)) ?? []).length >= 1, "the friend's pane did not play the unlock");

  for (const name of ["Vikram", "Sahiti", "Tharun"]) {
    await page.getByRole("button", { name }).click();
    await right.getByRole("heading", { name: `An Ode for ${name}` }).waitFor({ timeout: 15_000 });
  }
  console.log("split screen: the picker switched the right pane between Tharun, Vikram and Sahiti");

  // The chorus drop: locked on both panes until every friend is fully repaid; the last full repayment drops it on both.
  // The fake ledger owes Tharun $97.50 (paid $50 above), Vikram $82.50 and Sahiti $77.50.
  const dropText = "Full Ode dropped · Florida '25";
  const countdownOf = (pane) => pane.getByLabel("Release date").innerText();
  assert.equal(await countdownOf(left), "0 of 3 friends · 10 days to drop", "the payer's pane does not show the countdown");
  assert.equal(await countdownOf(right), "0 of 3 friends · 10 days to drop", "the friend's pane does not show the countdown");
  for (const [pane, name] of [[left, "payer"], [right, "friend"]]) {
    assert.equal(await pane.getByText(/Full Ode dropped/).count(), 0, `the ${name}'s pane shows the drop before anyone is repaid`);
    assert.equal(await pane.getByLabel("Locked chorus").count(), 1, `the ${name}'s pane does not show the chorus locked`);
  }
  for (const [friendName, amount] of [["Tharun", "47.50"], ["Vikram", "82.50"]]) {
    await left.getByLabel(new RegExp(`Pay ${friendName}`)).fill(amount);
    await left.getByRole("button", { name: `Pay ${friendName}` }).click();
    await left.getByRole("button", { name: `${friendName} is fully repaid` }).waitFor();
  }
  await left.getByLabel(/Pay Sahiti/).fill("77.49");
  await left.getByRole("button", { name: "Pay Sahiti" }).click();
  await left.getByText("Sahiti: lines 1, 2, 3 unlocked!").waitFor();
  assert.equal(await left.getByText(/Full Ode dropped/).count(), 0, "the drop shows while Sahiti is a cent short");
  assert.equal(await right.getByText(/Full Ode dropped/).count(), 0, "the friend's pane shows the drop while Sahiti is a cent short");
  assert.equal(await countdownOf(left), "2 of 3 friends · 10 days to drop", "the payer's countdown does not count repaid friends");

  // The date passes with Sahiti a cent short: both panes say delayed, gently, and the chorus stays locked. The friend's open
  // pane follows by itself; the payer's page asks again on a reload.
  const delayText = `Delayed · 2 of 3 friends repaid · was due ${dayIso(10)}`;
  const clock = await fetch(`http://localhost:${port}/dev/clock/advance-days`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ days: 11 }),
  });
  assert.equal(clock.status, 200, "dev-fake did not move the clock");
  const delayedAt = Date.now();
  await right.getByLabel("Release date").filter({ hasText: delayText }).waitFor({ timeout: 15_000 });
  const delayMs = Date.now() - delayedAt;
  console.log(`release date: the friend's open pane showed "${delayText}" after ${delayMs} ms`);
  assert.ok(delayMs < 2500, `the friend's pane took ${delayMs} ms to show the delay`);
  await page.reload();
  await left.getByLabel("Release date").filter({ hasText: delayText }).waitFor({ timeout: 15_000 });
  for (const [pane, name] of [[left, "payer"], [right, "friend"]]) {
    assert.equal(await pane.getByLabel("Locked chorus").count(), 1, `the ${name}'s pane unlocked the chorus when the date passed`);
    assert.equal(await pane.getByText(/Full Ode dropped/).count(), 0, `the ${name}'s pane dropped the chorus when the date passed`);
  }
  await page.screenshot({ path: `delayed-${screenshot}` });

  await left.getByLabel(/Pay Sahiti/).fill("0.01");
  await left.getByRole("button", { name: "Pay Sahiti" }).click();
  const droppedAt = Date.now();
  await right.getByText(dropText).waitFor();
  const dropMs = Date.now() - droppedAt;
  await left.getByText(dropText).waitFor();
  assert.equal(await left.getByLabel("Release date").count(), 0, "the payer's pane still counts down after the drop");
  assert.equal(await right.getByLabel("Release date").count(), 0, "the friend's pane still counts down after the drop");
  console.log(`split screen: the last payment dropped the chorus, "${dropText}", on the friend's pane after ${dropMs} ms and on the payer's`);
  assert.ok(dropMs < 2500, `the friend's pane took ${dropMs} ms to show the drop`);
  for (const [pane, name] of [[left, "payer"], [right, "friend"]]) {
    assert.equal(await pane.getByLabel("Locked chorus").count(), 0, `the ${name}'s pane still shows the chorus locked after the drop`);
  }

  const box = async (title) => (await page.locator(`iframe[title="${title}"]`).boundingBox()) ?? assert.fail(`no ${title} pane`);
  const [payer, friend2] = [await box("Payer"), await box("Friend view")];
  // The friend's pane sits under the picker, so it starts a little lower than the payer's; side by side means to its right and overlapping it vertically.
  assert.ok(friend2.x >= payer.x + payer.width - 1 && friend2.y < payer.y + payer.height, "panes are not side by side on a wide screen");
  await page.setViewportSize({ width: 390, height: 900 });
  const [narrowPayer, narrowFriend] = [await box("Payer"), await box("Friend view")];
  assert.ok(narrowFriend.y >= narrowPayer.y + narrowPayer.height - 1 && Math.abs(narrowFriend.x - narrowPayer.x) < 2, "panes do not stack on a phone");
  assert.ok(narrowPayer.width <= 390 && narrowFriend.width <= 390, "a pane is wider than the phone");
  console.log("split screen: side by side when wide, stacked at phone width");
  await page.screenshot({ path: `split-${screenshot}`, fullPage: true });

  // One copy per visitor: a second browser (its own context, so its own cookie) lands on the split screen with the Ode
  // and nothing paid, while the first browser's copy stays fully repaid with the chorus dropped. Each browser reads
  // Tharun's friend view, whose $97.50 the first browser repaid above.
  const repaid = (pane, amount) =>
    pane.getByLabel("Your money").filter({ hasText: new RegExp(`Repaid so far: \\$${amount.toFixed(2).replace(".", "\\.")}`) }).waitFor({ timeout: 15_000 });
  await page.setViewportSize({ width: 900, height: 1400 });
  await page.getByRole("button", { name: "Tharun" }).click();
  await repaid(right, 97.5);

  const otherContext = await browser.newContext({ viewport: { width: 900, height: 1400 } });
  const other = await otherContext.newPage();
  await other.goto(`http://localhost:${port}/`);
  const otherLeft = other.frameLocator('iframe[title="Payer"]');
  const otherRight = other.frameLocator('iframe[title="Friend view"]');
  await otherLeft.getByText("Your Ode").waitFor({ timeout: 30_000 });
  await other.getByRole("button", { name: "Tharun" }).click();
  await repaid(otherRight, 0);
  await repaid(right, 97.5);
  // The other copy has every friend unpaid, so its chorus is still locked while the first copy's has dropped.
  assert.equal(await otherLeft.getByText(/Full Ode dropped/).count(), 0, "the second browser shows the first browser's chorus drop");
  assert.equal(await otherLeft.getByLabel("Locked chorus").count(), 1, "the second browser's chorus is not locked");
  assert.equal(await left.getByText(dropText).count(), 1, "the first browser lost its chorus drop");
  console.log("visitor copies: a second browser lands on the split screen with everything unpaid and the chorus locked, the first still has Tharun repaid and the chorus dropped");

  await otherLeft.getByLabel(/Pay Tharun/).fill("20");
  await otherLeft.getByRole("button", { name: "Pay Tharun" }).click();
  await repaid(otherRight, 20);
  await page.reload();
  await page.getByRole("button", { name: "Tharun" }).click();
  await repaid(page.frameLocator('iframe[title="Friend view"]'), 97.5);
  await page.frameLocator('iframe[title="Payer"]').getByText(dropText).waitFor();
  console.log("visitor copies: paying in the second browser left the first at $97.50, and a reload keeps each copy");

  // "Reset demo" starts this browser's copy from zero and leaves the other browser's copy alone.
  await page.getByRole("button", { name: "Reset demo" }).click();
  const resetAt = Date.now();
  await repaid(page.frameLocator('iframe[title="Friend view"]'), 0);
  const resetMs = Date.now() - resetAt;
  console.log(`visitor copies: Reset demo showed Tharun unpaid after ${resetMs} ms`);
  assert.ok(resetMs < 5000, `Reset demo took ${resetMs} ms to show the copy unpaid`);
  await page.frameLocator('iframe[title="Payer"]').getByLabel("Locked chorus").waitFor({ timeout: 15_000 });
  await other.reload();
  await other.getByRole("button", { name: "Tharun" }).click();
  await repaid(other.frameLocator('iframe[title="Friend view"]'), 20);

  // A visitor whose cookie is gone gets a fresh unpaid copy.
  await otherContext.clearCookies();
  await other.reload();
  await other.getByRole("button", { name: "Tharun" }).click();
  await repaid(other.frameLocator('iframe[title="Friend view"]'), 0);
  console.log("visitor copies: Reset demo cleared only its own copy, and a cleared cookie gave a fresh one");
  await otherContext.close();

  // Judges' own Odes: a visitor on the Seeded Ode can make a new one from their own notes (two friends here, paid through the
  // first two sandbox accounts), without touching anyone else's. The fake clock was moved past the earlier release dates, so
  // these are set from the clock's day now.
  const goaNotes = "Goa '26: Meera covered the villa, I owe her $200. Dev paid for the scooters, $60.";
  const releaseOn = dayIso(11 + 5);
  const judgeContext = await browser.newContext({ viewport: { width: 900, height: 1400 } });
  const judge = await judgeContext.newPage();
  await judge.goto(`http://localhost:${port}/`);
  const judgeLeft = judge.frameLocator('iframe[title="Payer"]');
  const judgeRight = judge.frameLocator('iframe[title="Friend view"]');
  await judgeLeft.getByText("Your Ode").waitFor({ timeout: 30_000 });
  assert.equal(await judge.getByRole("button", { name: "Back to the Seeded Ode" }).count(), 0, "a visitor starts on the Seeded Ode, not on their own");
  await judge.getByRole("button", { name: "Make my own Ode" }).click();
  await judge.getByText("Your own Ode").waitFor();
  await judgeLeft.locator("textarea").fill(goaNotes);
  await judgeLeft.getByRole("button", { name: "Build the ledger" }).click();
  await judgeLeft.getByText("Meera").first().waitFor();
  await judgeLeft.getByRole("button", { name: "Write the lyrics" }).click();
  await judgeLeft.getByLabel("Release date").fill(releaseOn);
  await judgeLeft.getByRole("button", { name: "Make the Ode" }).click();
  await judgeLeft.getByText("Your Ode").waitFor({ timeout: 30_000 });
  await judgeRight.getByRole("heading", { name: "An Ode for Meera" }).waitFor({ timeout: 15_000 });
  assert.equal(await judge.getByRole("button", { name: "Tharun" }).count(), 0, "the judge's picker offers a friend of the Seeded Ode");
  assert.equal(await judge.getByRole("button", { name: "Dev" }).count(), 1, "the judge's picker lacks their second friend");
  await judgeLeft.getByLabel(/Pay Meera/).fill("100");
  await judgeLeft.getByRole("button", { name: "Pay Meera" }).click();
  const judgePaidAt = Date.now();
  await judgeRight.getByRole("status").waitFor();
  const judgeMs = Date.now() - judgePaidAt;
  console.log(`own Ode: paying Meera unlocked her lines in the judge's friend pane after ${judgeMs} ms`);
  assert.ok(judgeMs < 2500, `the judge's friend pane took ${judgeMs} ms to show the unlock`);
  await judge.screenshot({ path: `own-${screenshot}`, fullPage: true });

  // The Seeded Ode is as it was for everyone else: the first browser still shows its three friends.
  await page.reload();
  assert.equal(await page.getByRole("button", { name: "Meera" }).count(), 0, "the judge's friend leaked into another browser's Seeded Ode");
  await page.getByRole("button", { name: "Tharun" }).waitFor();
  console.log("own Ode: the judge's Ode with Meera and Dev sits beside the Seeded Ode, which still shows Tharun, Vikram and Sahiti");

  // Back to the Seeded Ode: the judge's own Ode is forgotten.
  await judge.getByRole("button", { name: "Back to the Seeded Ode" }).click();
  await judge.getByRole("button", { name: "Make my own Ode" }).waitFor();
  await judge.getByRole("button", { name: "Tharun" }).waitFor({ timeout: 15_000 });
  console.log("own Ode: Back to the Seeded Ode returned the judge to Tharun, Vikram and Sahiti");

  // The day's cap: four more new Odes start (through the API, each as a browser of its own), which with the judge's is five.
  // The sixth judge is told, and stays on the Seeded Ode.
  for (let n = 0; n < 4; n += 1) {
    const maker = await browser.newContext();
    const call = async (method, path, data) => {
      const res = await maker.request.fetch(`http://localhost:${port}${path}`, { method, ...(data ? { data } : {}) });
      assert.ok(res.ok(), `${method} ${path} answered ${res.status()}`);
    };
    await call("POST", "/api/judge-ode");
    await call("POST", "/api/ledger", { notes: goaNotes });
    await call("POST", "/api/lyrics", {});
    await call("POST", "/api/ode", { releaseDate: releaseOn });
    await maker.close();
  }
  await judge.getByRole("button", { name: "Make my own Ode" }).click();
  const capNotice = judge.getByRole("alert").filter({ hasText: "new Odes have all been made" });
  await capNotice.waitFor({ timeout: 15_000 });
  console.log(`own Ode: the sixth new Ode of the day was told: "${await capNotice.innerText()}"`);
  assert.equal(await judge.getByRole("button", { name: "Back to the Seeded Ode" }).count(), 0, "the judge is on their own Ode past the cap");
  await judge.getByRole("button", { name: "Tharun" }).waitFor();
  await judgeContext.close();
} finally {
  await browser.close();
}
