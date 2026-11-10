import { describe, expect, it } from "vitest";
import { fakeClaudeByTask } from "../src/testing/fakes.ts";
import { createHarness, pollUntil } from "./harness.ts";
import { seedExtraction, seedFriendAccounts, seedLyrics, seedNotes } from "./seed.ts";

interface PaymentBody {
  amountOwedCents: number;
  amountRepaidCents: number;
  linesUnlocked: number;
  nextLineAtCents: number | null;
  canPay: boolean;
}
interface VerseBody {
  kind: "verse";
  friend: string;
  lines: { text: string; locked: boolean }[];
  payment: PaymentBody | null;
}
interface OdeBody {
  status: string;
  sections: { kind: string }[];
}

async function json<T>(res: Response): Promise<T> {
  return res.json();
}

// Tharun owes $97.50, Vikram $82.50, Sahiti $77.50 (seed notes: group parking split four ways).
const THARUN = "Tharun";

/** The seed ledger with its lyrics written and the Ode made, so there are lines to unlock. */
async function odeHarness() {
  const harness = await createHarness({
    claude: fakeClaudeByTask({ "extract-ledger": () => seedExtraction, "write-lyrics": () => seedLyrics }),
  });
  await harness.post("/api/ledger", { notes: seedNotes });
  await harness.post("/api/lyrics", {});
  await harness.post("/api/ode", {});
  await pollUntil(
    async () => json<OdeBody>(await harness.get("/api/ode")),
    (ode) => ode.status === "ready",
  );
  return harness;
}

type Harness = Awaited<ReturnType<typeof odeHarness>>;

/** What the cassette page is told about each friend's verse. */
async function verses(harness: Pick<Harness, "get">): Promise<Record<string, VerseBody>> {
  const ode = await json<{ sections: (VerseBody | { kind: string })[] }>(await harness.get("/api/ode"));
  const found = ode.sections.filter((s): s is VerseBody => s.kind === "verse");
  return Object.fromEntries(found.map((verse) => [verse.friend, verse]));
}

const lockedLines = (verse: VerseBody | undefined) => verse?.lines.map((line) => line.locked);

/** Pay a friend the way the page does: create the order, then capture it once the payer approves. */
async function pay(harness: Pick<Harness, "post">, friend: string, amountCents: number) {
  const created = await harness.post("/api/payments/orders", { friend, amountCents });
  if (created.status !== 200) return { created, captured: undefined };
  const { orderId } = await json<{ orderId: string }>(created);
  return { created, captured: await harness.post("/api/payments/capture", { orderId }) };
}

describe("paying a friend", () => {
  it("starts with every line locked and every amount owed repaid by nothing", async () => {
    const harness = await odeHarness();

    const all = await verses(harness);

    expect(Object.keys(all)).toEqual(["Tharun", "Vikram", "Sahiti"]);
    for (const verse of Object.values(all)) {
      expect(lockedLines(verse)).toEqual([true, true, true, true]);
      expect(verse.payment).toMatchObject({ amountRepaidCents: 0, linesUnlocked: 0, canPay: true });
    }
    expect(all["Tharun"]?.payment).toMatchObject({ amountOwedCents: 9_750, nextLineAtCents: 2_438 });
  });

  it("unlocks exactly lines 1 and 2 when $50 of Tharun's $97.50 is paid, and the money reaches his sandbox account", async () => {
    const harness = await odeHarness();

    const { captured } = await pay(harness, THARUN, 5_000);

    expect(captured?.status).toBe(200);
    const all = await verses(harness);
    expect(lockedLines(all["Tharun"])).toEqual([false, false, true, true]);
    expect(lockedLines(all["Vikram"])).toEqual([true, true, true, true]);
    expect(lockedLines(all["Sahiti"])).toEqual([true, true, true, true]);
    expect(harness.paypal.receivedBy(seedFriendAccounts["Tharun"] ?? "")).toBe(5_000);
    expect(harness.paypal.receivedBy(seedFriendAccounts["Vikram"] ?? "")).toBe(0);
  });

  it("tells the page the next line unlocks at $73.13, rounded up to the cent", async () => {
    const harness = await odeHarness();

    await pay(harness, THARUN, 5_000);

    const tharun = (await verses(harness))["Tharun"];
    expect(tharun?.payment).toEqual({
      amountOwedCents: 9_750,
      amountRepaidCents: 5_000,
      linesUnlocked: 2,
      nextLineAtCents: 7_313,
      canPay: true,
    });
    // Paying exactly that amount (the $23.13 still to go) unlocks line 3.
    await pay(harness, THARUN, 2_313);
    expect(lockedLines((await verses(harness))["Tharun"])).toEqual([false, false, false, true]);
  });

  it("answers the capture with the friend's new standing", async () => {
    const harness = await odeHarness();

    const { captured } = await pay(harness, THARUN, 5_000);

    expect(await json(captured as Response)).toEqual({
      friend: "Tharun",
      amountOwedCents: 9_750,
      amountRepaidCents: 5_000,
      linesUnlocked: 2,
      nextLineAtCents: 7_313,
      canPay: true,
    });
  });

  it("keeps what was paid across a restart of the web service", async () => {
    const harness = await odeHarness();
    await pay(harness, THARUN, 5_000);

    const restarted = harness.restartWebService();

    expect(lockedLines((await verses(restarted))["Tharun"])).toEqual([false, false, true, true]);
  });

  it("adds up payments, so each 25% step unlocks the next line in order", async () => {
    const harness = await odeHarness();

    await pay(harness, THARUN, 2_437);
    expect(lockedLines((await verses(harness))["Tharun"])).toEqual([true, true, true, true]);
    await pay(harness, THARUN, 1);
    expect(lockedLines((await verses(harness))["Tharun"])).toEqual([false, true, true, true]);
    await pay(harness, THARUN, 4_874);
    expect(lockedLines((await verses(harness))["Tharun"])).toEqual([false, false, true, true]);
    await pay(harness, THARUN, 1);
    expect(lockedLines((await verses(harness))["Tharun"])).toEqual([false, false, false, true]);
    await pay(harness, THARUN, 2_437);
    expect(lockedLines((await verses(harness))["Tharun"])).toEqual([false, false, false, false]);
  });

  it("counts the whole amount paid, since the capture reports the gross amount before fees", async () => {
    const harness = await odeHarness();

    const { captured } = await pay(harness, "Vikram", 4_125);

    expect(await json<PaymentBody>(captured as Response)).toMatchObject({ amountRepaidCents: 4_125, linesUnlocked: 2 });
  });

  it("refuses a payment above what is still owed, and creates no order", async () => {
    const harness = await odeHarness();
    await pay(harness, THARUN, 5_000);

    const { created } = await pay(harness, THARUN, 4_751);

    expect(created.status).toBe(422);
    expect(await json(created)).toEqual({ error: "Tharun is owed $47.50 more. Pay that or less." });
    expect(harness.paypal.orderCount()).toBe(1);
  });

  it("takes the exact amount still owed, and then the friend can't be paid again", async () => {
    const harness = await odeHarness();

    const full = await pay(harness, THARUN, 9_750);
    const again = await pay(harness, THARUN, 100);

    expect(full.captured?.status).toBe(200);
    const tharun = (await verses(harness))["Tharun"];
    expect(lockedLines(tharun)).toEqual([false, false, false, false]);
    expect(tharun?.payment).toMatchObject({ amountRepaidCents: 9_750, nextLineAtCents: null, canPay: false });
    expect(again.created.status).toBe(422);
    expect(await json(again.created)).toEqual({ error: "Tharun is fully repaid." });
    expect(harness.paypal.receivedBy(seedFriendAccounts["Tharun"] ?? "")).toBe(9_750);
  });

  it("refuses an order whose capture would take a friend past what is owed, when two orders were open", async () => {
    const harness = await odeHarness();
    const first = await json<{ orderId: string }>(await harness.post("/api/payments/orders", { friend: THARUN, amountCents: 9_000 }));
    const second = await json<{ orderId: string }>(await harness.post("/api/payments/orders", { friend: THARUN, amountCents: 9_000 }));

    const one = await harness.post("/api/payments/capture", first);
    const two = await harness.post("/api/payments/capture", second);

    expect(one.status).toBe(200);
    expect(two.status).toBe(422);
    expect(harness.paypal.receivedBy(seedFriendAccounts["Tharun"] ?? "")).toBe(9_000);
    expect((await verses(harness))["Tharun"]?.payment?.amountRepaidCents).toBe(9_000);
  });

  it("unlocks nothing and says so when the payment is declined", async () => {
    const harness = await odeHarness();
    harness.paypal.declineNextCapture();

    const { captured } = await pay(harness, THARUN, 5_000);

    expect(captured?.status).toBe(402);
    expect(await json(captured as Response)).toEqual({ error: "Your payment didn't go through. Nothing was sent." });
    expect(lockedLines((await verses(harness))["Tharun"])).toEqual([true, true, true, true]);
    expect(harness.paypal.receivedBy(seedFriendAccounts["Tharun"] ?? "")).toBe(0);
  });

  it("unlocks nothing when the popup is closed before the payment is approved", async () => {
    const harness = await odeHarness();

    const created = await harness.post("/api/payments/orders", { friend: THARUN, amountCents: 5_000 });

    expect(created.status).toBe(200);
    const tharun = (await verses(harness))["Tharun"];
    expect(lockedLines(tharun)).toEqual([true, true, true, true]);
    expect(tharun?.payment?.amountRepaidCents).toBe(0);
  });

  it("counts a capture once however many times the same order is captured", async () => {
    const harness = await odeHarness();
    const { orderId } = await json<{ orderId: string }>(await harness.post("/api/payments/orders", { friend: THARUN, amountCents: 5_000 }));

    await harness.post("/api/payments/capture", { orderId });
    await harness.post("/api/payments/capture", { orderId });

    expect((await verses(harness))["Tharun"]?.payment?.amountRepaidCents).toBe(5_000);
  });

  it.each([
    ["zero", 0],
    ["negative", -500],
    ["a fraction of a cent", 12.5],
    ["text", "50"],
    ["missing", undefined],
  ])("refuses an amount that is %s", async (_case, amountCents) => {
    const harness = await odeHarness();

    const { created } = await pay(harness, THARUN, amountCents as number);

    expect(created.status).toBe(422);
    expect(await json(created)).toEqual({ error: "Enter an amount in whole cents, at least 1." });
    expect(harness.paypal.orderCount()).toBe(0);
  });

  it("refuses a payment to someone who is not on the ledger", async () => {
    const harness = await odeHarness();

    const { created } = await pay(harness, "Nobody", 100);

    expect(created.status).toBe(404);
    expect(await json(created)).toEqual({ error: "Nobody is not on the ledger." });
  });

  it("refuses to capture an order that was not for one of the friends", async () => {
    const harness = await odeHarness();
    const stranger = await harness.paypal.createOrder({ friendEmail: "stranger@example.com", amountCents: 100 });
    if (stranger._tag === "err") throw stranger.error;

    const captured = await harness.post("/api/payments/capture", { orderId: stranger.value.orderId });

    expect(captured.status).toBe(422);
    expect(harness.paypal.receivedBy("stranger@example.com")).toBe(0);
  });

  it("refuses to capture an order PayPal does not know", async () => {
    const harness = await odeHarness();

    const captured = await harness.post("/api/payments/capture", { orderId: "NOPE" });

    expect(captured.status).toBe(502);
    expect(await json(captured)).toEqual({ error: "Couldn't reach PayPal just now. Try again in a moment." });
  });

  it("asks the payer to try again when PayPal is down", async () => {
    const harness = await odeHarness();
    harness.paypal.failNextRequest();

    const { created } = await pay(harness, THARUN, 5_000);

    expect(created.status).toBe(502);
    expect(await json(created)).toEqual({ error: "Couldn't reach PayPal just now. Try again in a moment." });
  });

  it("shows no PayPal client ID when none is configured, so the page offers its keyless Pay button", async () => {
    const harness = await odeHarness();

    expect(await json(await harness.get("/api/config"))).toEqual({ paypalClientId: null });
  });
});
