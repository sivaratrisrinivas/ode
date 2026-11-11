import { describe, expect, it } from "vitest";
import { fakeClaudeByTask, fakeMusic } from "../src/testing/fakes.ts";
import { createHarness, MAKE_ODE, pollUntil } from "./harness.ts";
import { goaExtraction, goaNotes, lyricsForFriends, seedExtraction, seedFriendAccounts, seedNotes } from "./seed.ts";

interface Standing {
  amountOwedCents: number;
  amountRepaidCents: number;
  linesUnlocked: number;
}
interface VerseBody {
  kind: "verse";
  friend: string;
  lines: { locked: boolean }[];
  payment: Standing | null;
  friendViewPath: string;
}
interface OdeBody {
  status: string;
  trip?: string;
  error?: string;
  audioUrl?: string;
  sections?: (VerseBody | { kind: string })[];
}

async function json<T>(res: Response): Promise<T> {
  return res.json();
}

const JUDGE_NOTES = goaNotes;
const FOUR_FRIEND_NOTES = "Four friends covered things: Ana, Ben, Cy and Di.";
/** Notes whose one friend shares a name with a Seeded Ode friend. */
const TWIN_NOTES = "Tharun covered everything on my second trip, $100.";

const extractions: Record<string, unknown> = {
  [seedNotes.trim()]: seedExtraction,
  [JUDGE_NOTES]: goaExtraction,
  [FOUR_FRIEND_NOTES]: {
    friends: ["Ana", "Ben", "Cy", "Di"].map((name) => ({ name, amountOwedCents: 1_000, amountIsEstimate: false, insideJoke: "Sang loudly" })),
    groupCosts: [],
    trip: "Four friends",
  },
  [TWIN_NOTES]: {
    friends: [{ name: "Tharun", amountOwedCents: 10_000, amountIsEstimate: false, insideJoke: "Missed the ferry by a minute" }],
    groupCosts: [],
    trip: "Second trip",
  },
};

/** The Seeded Ode made, and the way to be a judge: each `newBrowser()` is one more visitor. */
async function judgesHarness() {
  const music = fakeMusic();
  const harness = await createHarness({
    music,
    claude: fakeClaudeByTask({
      "extract-ledger": (notes) => {
        const found = extractions[notes];
        if (found === undefined) throw new Error(`no canned extraction for: ${notes}`);
        return found;
      },
      "write-lyrics": lyricsForFriends,
    }),
  });
  await harness.post("/api/ledger", { notes: seedNotes });
  await harness.post("/api/lyrics", {});
  await harness.post("/api/ode", MAKE_ODE);
  await pollUntil(async () => json<OdeBody>(await harness.get("/api/ode")), (ode) => ode.status === "ready");
  // The seed is the payer's own; the browser that made it is no judge.
  return { ...harness, music, judge: () => harness.newBrowser() };
}

type Harness = Awaited<ReturnType<typeof judgesHarness>>;
type Browser = ReturnType<Harness["judge"]>;

/** A judge starts their own Ode, builds the ledger and lyrics from `notes` and makes it, answering with the last request. */
async function makeOwnOde(judge: Browser, notes = JUDGE_NOTES) {
  await judge.post("/api/judge-ode", {});
  await judge.post("/api/ledger", { notes });
  await judge.post("/api/lyrics", {});
  return judge.post("/api/ode", MAKE_ODE);
}

const ready = (judge: Browser) => pollUntil(async () => json<OdeBody>(await judge.get("/api/ode")), (ode) => ode.status === "ready");

/** Pay a friend the way the page does: create the order, then capture it. */
async function pay(browser: Pick<Browser, "post">, friend: string, amountCents: number) {
  const { orderId } = await json<{ orderId: string }>(await browser.post("/api/payments/orders", { friend, amountCents }));
  return browser.post("/api/payments/capture", { orderId });
}

describe("a judge's own Ode", () => {
  it("pays the first two sandbox friend accounts, in order, for a two-friend Ode", async () => {
    const harness = await judgesHarness();
    const judge = harness.judge();
    await makeOwnOde(judge);
    await ready(judge);

    expect((await pay(judge, "Meera", 20_000)).status).toBe(200);
    expect((await pay(judge, "Dev", 1_500)).status).toBe(200);

    expect(harness.paypal.receivedBy(seedFriendAccounts["Tharun"] ?? "")).toBe(20_000);
    expect(harness.paypal.receivedBy(seedFriendAccounts["Vikram"] ?? "")).toBe(1_500);
    expect(harness.paypal.receivedBy(seedFriendAccounts["Sahiti"] ?? "")).toBe(0);
  });

  it("is the judge's own: other visitors keep the Seeded Ode", async () => {
    const harness = await judgesHarness();
    const judge = harness.judge();
    const other = harness.judge();
    await makeOwnOde(judge);

    const mine = await ready(judge);
    const theirs = await json<OdeBody>(await other.get("/api/ode"));

    expect(mine.trip).toBe("Goa '26");
    expect(mine.sections?.filter((section) => section.kind === "verse").map((verse) => (verse as VerseBody).friend)).toEqual(["Meera", "Dev"]);
    expect(theirs.trip).toBe("Florida '25");
  });
});

describe("the day's cap on new Odes", () => {
  const CAP_MESSAGE = /Today's 5 new Odes have all been made, so here is the Seeded Ode instead/;

  /** Five judges each make an Ode. */
  async function useUpTheDay(harness: Harness) {
    for (let judge = 1; judge <= 5; judge += 1) {
      const browser = harness.judge();
      expect((await makeOwnOde(browser)).status).toBe(202);
      await ready(browser);
    }
  }

  it("sends the 6th new Ode of the day to the Seeded Ode, with a message", async () => {
    const harness = await judgesHarness();
    await useUpTheDay(harness);
    const sixth = harness.judge();

    const entered = await sixth.post("/api/judge-ode", {});

    expect(entered.status).toBe(429);
    expect((await json<{ error: string }>(entered)).error).toMatch(CAP_MESSAGE);
    expect((await json<{ mine: boolean }>(await sixth.get("/api/judge-ode"))).mine).toBe(false);
    expect((await json<OdeBody>(await sixth.get("/api/ode"))).trip).toBe("Florida '25");
  });

  it("falls back to the Seeded Ode, with the message, when the day's last place goes while the judge is writing their notes", async () => {
    const harness = await judgesHarness();
    const late = harness.judge();
    await late.post("/api/judge-ode", {});
    await late.post("/api/ledger", { notes: JUDGE_NOTES });
    await late.post("/api/lyrics", {});
    await useUpTheDay(harness);

    const made = await late.post("/api/ode", MAKE_ODE);

    expect(made.status).toBe(429);
    expect((await json<{ error: string }>(made)).error).toMatch(CAP_MESSAGE);
    expect((await json<OdeBody>(await late.get("/api/ode"))).trip).toBe("Florida '25");
    expect((await json<{ rows: unknown[] }>(await late.get("/api/ledger"))).rows).toHaveLength(3);
  });

  it("opens again the next day", async () => {
    const harness = await judgesHarness();
    await useUpTheDay(harness);
    const sixth = harness.judge();
    expect((await sixth.post("/api/judge-ode", {})).status).toBe(429);

    harness.clock.advance(24 * 60 * 60 * 1000);

    expect((await makeOwnOde(sixth)).status).toBe(202);
    expect((await ready(sixth)).trip).toBe("Goa '26");
  });

  it("counts the day by the clock's UTC date, so it is still the same day an hour before midnight", async () => {
    const harness = await judgesHarness();
    harness.clock.set(new Date("2026-11-09T23:30:00.000Z"));
    await useUpTheDay(harness);

    harness.clock.set(new Date("2026-11-09T23:59:59.000Z"));
    expect((await harness.judge().post("/api/judge-ode", {})).status).toBe(429);
    harness.clock.set(new Date("2026-11-10T00:00:00.000Z"));
    expect((await harness.judge().post("/api/judge-ode", {})).status).toBe(200);
  });

  it("counts an Ode when its song starts being made, so a judge who only looks does not use a place", async () => {
    const harness = await judgesHarness();
    for (let looker = 0; looker < 8; looker += 1) await harness.judge().post("/api/judge-ode", {});

    const maker = harness.judge();

    expect((await makeOwnOde(maker)).status).toBe(202);
    await ready(maker);
  });

  it("does not count a retry of a failed run as another new Ode", async () => {
    const harness = await judgesHarness();
    for (let judge = 1; judge <= 4; judge += 1) {
      const browser = harness.judge();
      await makeOwnOde(browser);
      await ready(browser);
    }
    const flaky = harness.judge();
    harness.music.failNextCompose();
    await makeOwnOde(flaky);
    await pollUntil(async () => json<OdeBody>(await flaky.get("/api/ode")), (ode) => ode.status === "failed");

    expect((await flaky.post("/api/ode", MAKE_ODE)).status).toBe(202);
    expect((await ready(flaky)).trip).toBe("Goa '26");
  });

  /** The day has exactly one place left: the next judge gets it, as their own Ode (not the uncapped Seeded Ode), and the one after is told no. */
  async function expectOneMoreOdeFits(harness: Harness) {
    const fifth = harness.judge();
    expect((await fifth.post("/api/judge-ode", {})).status).toBe(200);
    await fifth.post("/api/ledger", { notes: JUDGE_NOTES });
    await fifth.post("/api/lyrics", {});
    expect((await fifth.post("/api/ode", MAKE_ODE)).status).toBe(202);
    expect((await ready(fifth)).trip).toBe("Goa '26");
    expect((await harness.judge().post("/api/judge-ode", {})).status).toBe(429);
  }

  it("costs one place for one Ode, however many requests start it at once", async () => {
    const harness = await judgesHarness();
    for (let judge = 1; judge <= 3; judge += 1) {
      const browser = harness.judge();
      await makeOwnOde(browser);
      await ready(browser);
    }
    const double = harness.judge();
    await double.post("/api/judge-ode", {});
    await double.post("/api/ledger", { notes: JUDGE_NOTES });
    await double.post("/api/lyrics", {});

    await Promise.all([double.post("/api/ode", MAKE_ODE), double.post("/api/ode", MAKE_ODE)]);
    await ready(double);

    // Four places are used (three, and the double request's one), so a fifth Ode still fits.
    await expectOneMoreOdeFits(harness);
  });

  it("costs one place for one Ode when the Workflow refuses the first start and the judge tries again", async () => {
    const harness = await judgesHarness();
    for (let judge = 1; judge <= 3; judge += 1) {
      const browser = harness.judge();
      await makeOwnOde(browser);
      await ready(browser);
    }
    const retrying = harness.judge();
    harness.workflow.refuseNextStart();
    expect((await makeOwnOde(retrying)).status).toBe(502);

    expect((await retrying.post("/api/ode", MAKE_ODE)).status).toBe(202);
    await ready(retrying);

    await expectOneMoreOdeFits(harness);
  });

  it("does not count the payer's Seeded Ode", async () => {
    const harness = await judgesHarness();

    expect((await json<{ mine: boolean }>(await harness.get("/api/judge-ode"))).mine).toBe(false);
    await useUpTheDay(harness);
  });
});

describe("a judge's friends", () => {
  it("rejects notes naming more than 3 friends, clearly, and keeps the judge on their own empty Ode", async () => {
    const harness = await judgesHarness();
    const judge = harness.judge();
    await judge.post("/api/judge-ode", {});

    const res = await judge.post("/api/ledger", { notes: FOUR_FRIEND_NOTES });

    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toMatch(/up to 3 friends.*Ana, Ben, Cy, Di/);
    expect((await json<{ rows: unknown[] }>(await judge.get("/api/ledger"))).rows).toHaveLength(0);
  });

  it("count payments per Ode: a friend who shares a name with a Seeded Ode friend starts unpaid", async () => {
    const harness = await judgesHarness();
    const judge = harness.judge();
    await pay(judge, "Tharun", 5_000);
    expect(harness.paypal.receivedBy(seedFriendAccounts["Tharun"] ?? "")).toBe(5_000);

    await makeOwnOde(judge, TWIN_NOTES);
    const mine = await ready(judge);
    const tharun = mine.sections?.find((section): section is VerseBody => section.kind === "verse");

    expect(tharun?.payment).toMatchObject({ amountOwedCents: 10_000, amountRepaidCents: 0, linesUnlocked: 0 });
  });

  it("show a friend who opens their link on another device the judge's Ode and what the judge has paid", async () => {
    const harness = await judgesHarness();
    const judge = harness.judge();
    await makeOwnOde(judge);
    const ode = await ready(judge);
    const meera = ode.sections?.find((section): section is VerseBody => section.kind === "verse");
    await pay(judge, "Meera", 10_000);

    const phone = harness.judge();
    const view = await json<{ you: Standing; ode: OdeBody }>(await phone.get((meera?.friendViewPath ?? "").replace("/f/", "/api/friends/")));

    expect(view.you).toMatchObject({ amountOwedCents: 20_000, amountRepaidCents: 10_000, linesUnlocked: 2 });
    expect(view.ode.trip).toBe("Goa '26");
    const audio = await phone.get(view.ode.audioUrl ?? "");
    expect(audio.status).toBe(200);
  });

  it("keep paying through PayPal's webhook, which names only the order", async () => {
    const harness = await judgesHarness();
    const judge = harness.judge();
    await makeOwnOde(judge);
    await ready(judge);
    const { orderId } = await json<{ orderId: string }>(await judge.post("/api/payments/orders", { friend: "Dev", amountCents: 3_000 }));
    const capture = await harness.paypal.captureOrder(orderId);
    if (capture._tag === "err" || capture.value.status !== "COMPLETED") throw new Error("the fake PayPal did not complete the capture");

    const webhook = await harness.anonymous("/api/payments/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "paypal-transmission-sig": "valid" },
      body: JSON.stringify({
        id: "WH-3",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: capture.value.captureId,
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "30.00" },
          supplementary_data: { related_ids: { order_id: orderId } },
        },
      }),
    });

    expect(webhook.status).toBe(200);
    const ode = await json<OdeBody>(await judge.get("/api/ode"));
    const dev = ode.sections?.find((section): section is VerseBody => section.kind === "verse" && "friend" in section && section.friend === "Dev");
    expect(dev?.payment).toMatchObject({ amountRepaidCents: 3_000, linesUnlocked: 2 });
  });
});

describe("going back to the Seeded Ode", () => {
  it("returns the judge to the Seeded Ode and forgets their own", async () => {
    const harness = await judgesHarness();
    const judge = harness.judge();
    await makeOwnOde(judge);
    await ready(judge);

    const left = await judge.request("/api/judge-ode", { method: "DELETE" });

    expect(left.status).toBe(200);
    expect((await json<OdeBody>(await judge.get("/api/ode"))).trip).toBe("Florida '25");
    expect((await json<{ rows: { friend: string }[] }>(await judge.get("/api/ledger"))).rows.map((row) => row.friend)).toEqual(["Tharun", "Vikram", "Sahiti"]);
  });

  it("keeps a judge on their own Ode when they come back in the same browser", async () => {
    const harness = await judgesHarness();
    const judge = harness.judge();
    await makeOwnOde(judge);
    await ready(judge);

    expect((await json<OdeBody>(await judge.get("/api/ode"))).trip).toBe("Goa '26");
    expect((await json<{ mine: boolean }>(await judge.get("/api/judge-ode"))).mine).toBe(true);
  });
});
