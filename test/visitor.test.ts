import { describe, expect, it } from "vitest";
import { fakeClaudeByTask } from "../src/testing/fakes.ts";
import { createHarness, MAKE_ODE, pollUntil } from "./harness.ts";
import { seedExtraction, seedFriendAccounts, seedLyrics, seedNotes } from "../src/testing/seed.ts";

interface Standing {
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
interface FriendViewBody {
  you: Standing | null;
  ode: { sections: (VerseBody | { kind: string })[] };
}

async function json<T>(res: Response): Promise<T> {
  return res.json();
}

/** The seed ledger with its Ode made: the one Ode every visitor's copy is of. */
async function seededHarness() {
  const harness = await createHarness({
    claude: fakeClaudeByTask({ "extract-ledger": () => seedExtraction, "write-lyrics": () => seedLyrics }),
  });
  await harness.post("/api/ledger", { notes: seedNotes });
  await harness.post("/api/lyrics", {});
  await harness.post("/api/ode", MAKE_ODE);
  await pollUntil(
    async () => json<{ status: string }>(await harness.get("/api/ode")),
    (ode) => ode.status === "ready",
  );
  return harness;
}

type Harness = Awaited<ReturnType<typeof seededHarness>>;
/** Anything that makes requests as one browser. */
type Browser = Pick<Harness, "get" | "post">;

/** Each friend's verse as this browser's copy of the Ode shows it. */
async function verses(browser: Pick<Browser, "get">): Promise<Record<string, VerseBody>> {
  const ode = await json<{ sections: (VerseBody | { kind: string })[] }>(await browser.get("/api/ode"));
  const found = ode.sections.filter((section): section is VerseBody => section.kind === "verse");
  return Object.fromEntries(found.map((verse) => [verse.friend, verse]));
}

const lockedLines = (verse: VerseBody | undefined) => verse?.lines.map((line) => line.locked);

/** Pay a friend the way the page does: create the order, then capture it. */
async function pay(browser: Browser, friend: string, amountCents: number) {
  const { orderId } = await json<{ orderId: string }>(await browser.post("/api/payments/orders", { friend, amountCents }));
  return browser.post("/api/payments/capture", { orderId });
}

describe("a copy of the Seeded Ode for each visitor", () => {
  it("keeps what one browser pays out of the other browser's copy", async () => {
    const harness = await seededHarness();
    const other = harness.newBrowser();

    await pay(harness, "Tharun", 5_000);

    expect(lockedLines((await verses(harness))["Tharun"])).toEqual([false, false, true, true]);
    expect(lockedLines((await verses(other))["Tharun"])).toEqual([true, true, true, true]);
    expect((await verses(other))["Tharun"]?.payment).toMatchObject({ amountRepaidCents: 0, linesUnlocked: 0 });
  });

  it("gives a first visit a visitor cookie, on the page as well as the API, and keeps it to one visitor after that", async () => {
    const harness = await seededHarness();
    harness.clearCookies();

    const landing = await harness.get("/");
    const cookie = harness.cookie("ode_visitor");

    expect(cookie).toMatch(/^[0-9a-f-]{36}$/);
    expect(landing.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(landing.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
    expect(landing.headers.get("set-cookie")).toMatch(/Max-Age=\d{7,}/i);
    await harness.get("/api/ode");
    expect(harness.cookie("ode_visitor")).toBe(cookie);
  });

  it("keeps a returning browser's copy as it left it, across a restart of the web service", async () => {
    const harness = await seededHarness();
    await pay(harness, "Tharun", 5_000);

    const back = harness.restartWebService();

    expect(lockedLines((await verses(back))["Tharun"])).toEqual([false, false, true, true]);
  });

  it("gives a browser whose cookie was cleared a fresh unpaid copy", async () => {
    const harness = await seededHarness();
    await pay(harness, "Tharun", 5_000);
    const before = harness.cookie("ode_visitor");

    harness.clearCookies();

    expect(lockedLines((await verses(harness))["Tharun"])).toEqual([true, true, true, true]);
    expect(harness.cookie("ode_visitor")).not.toBe(before);
  });

  it("gives a browser with a made-up cookie a fresh unpaid copy and a real cookie", async () => {
    const harness = await seededHarness();
    const stranger = harness.newBrowser();

    const res = await stranger.request("/api/ode", { headers: { cookie: "ode_visitor=not-a-visitor-id" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^ode_visitor=[0-9a-f-]{36}/);
  });

  describe("Reset demo", () => {
    it("returns the copy to unpaid, so the friend can be paid again from zero", async () => {
      const harness = await seededHarness();
      await pay(harness, "Tharun", 5_000);
      await pay(harness, "Vikram", 8_250);

      const reset = await harness.post("/api/demo/reset", {});

      expect(reset.status).toBe(200);
      const all = await verses(harness);
      for (const verse of Object.values(all)) {
        expect(lockedLines(verse)).toEqual([true, true, true, true]);
        expect(verse.payment).toMatchObject({ amountRepaidCents: 0, linesUnlocked: 0 });
      }
      expect((await pay(harness, "Tharun", 9_750)).status).toBe(200);
      expect(lockedLines((await verses(harness))["Tharun"])).toEqual([false, false, false, false]);
    });

    it("leaves every other visitor's copy as it was", async () => {
      const harness = await seededHarness();
      const other = harness.newBrowser();
      await pay(harness, "Tharun", 5_000);
      await pay(other, "Tharun", 2_500);

      await harness.post("/api/demo/reset", {});

      expect((await verses(other))["Tharun"]?.payment).toMatchObject({ amountRepaidCents: 2_500, linesUnlocked: 1 });
    });

    it("forgets the orders the visitor made, so an old order can be neither captured nor counted by the webhook", async () => {
      const harness = await seededHarness();
      const { orderId } = await json<{ orderId: string }>(await harness.post("/api/payments/orders", { friend: "Tharun", amountCents: 5_000 }));
      const capture = await harness.paypal.captureOrder(orderId);
      if (capture._tag === "err" || capture.value.status !== "COMPLETED") throw new Error("the fake PayPal did not complete the capture");

      await harness.post("/api/demo/reset", {});

      expect((await harness.post("/api/payments/capture", { orderId })).status).toBe(422);
      const webhook = await harness.anonymous("/api/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "paypal-transmission-sig": "valid" },
        body: JSON.stringify({
          id: "WH-2",
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          resource: {
            id: capture.value.captureId,
            status: "COMPLETED",
            amount: { currency_code: "USD", value: "50.00" },
            supplementary_data: { related_ids: { order_id: orderId } },
          },
        }),
      });
      expect(webhook.status).toBe(200);
      expect((await verses(harness))["Tharun"]?.payment).toMatchObject({ amountRepaidCents: 0, linesUnlocked: 0 });
    });

    it("leaves the Ode and its audio in place for everyone", async () => {
      const harness = await seededHarness();

      await harness.post("/api/demo/reset", {});

      expect((await harness.get("/api/ode/audio")).status).toBe(200);
      expect(Object.keys(await verses(harness))).toEqual(["Tharun", "Vikram", "Sahiti"]);
    });
  });

  describe("friends' views", () => {
    /** Tharun's page path as this browser's payer page shows it. */
    async function tharunView(browser: Browser) {
      const path = (await verses(browser))["Tharun"]?.friendViewPath ?? "";
      return json<FriendViewBody>(await browser.get(path.replace("/f/", "/api/friends/")));
    }

    it("shows a friend's page the copy of whoever is looking, not another visitor's payments", async () => {
      const harness = await seededHarness();
      const other = harness.newBrowser();
      await pay(harness, "Tharun", 5_000);

      expect((await tharunView(harness)).you).toMatchObject({ amountRepaidCents: 5_000, linesUnlocked: 2 });
      expect((await tharunView(other)).you).toMatchObject({ amountRepaidCents: 0, linesUnlocked: 0 });
    });

    it("pushes an unlock to the open view of the visitor who paid, and not to another visitor's", async () => {
      const harness = await seededHarness();
      const other = harness.newBrowser();
      const path = (await verses(harness))["Tharun"]?.friendViewPath.replace("/f/", "/api/friends/") ?? "";
      const [payerStream, otherStream] = await Promise.all([harness.get(`${path}/events`), other.get(`${path}/events`)]);
      const payerRead = payerStream.body?.getReader();
      const otherRead = otherStream.body?.getReader();
      const decoder = new TextDecoder();
      await payerRead?.read();
      await otherRead?.read();

      await pay(harness, "Tharun", 5_000);

      const pushed = await payerRead?.read();
      expect(decoder.decode(pushed?.value)).toContain('"linesUnlocked":2');
      const quiet = await Promise.race([otherRead?.read(), new Promise<"quiet">((resolve) => setTimeout(() => resolve("quiet"), 600))]);
      expect(quiet).toBe("quiet");
      await payerRead?.cancel();
      await otherRead?.cancel();
    });
  });

  describe("PayPal", () => {
    it("counts a payment captured by PayPal's webhook, which carries no cookie, in the copy of the visitor who made the order", async () => {
      const harness = await seededHarness();
      const other = harness.newBrowser();
      const { orderId } = await json<{ orderId: string }>(await harness.post("/api/payments/orders", { friend: "Tharun", amountCents: 5_000 }));
      const capture = await harness.paypal.captureOrder(orderId);
      if (capture._tag === "err" || capture.value.status !== "COMPLETED") throw new Error("the fake PayPal did not complete the capture");
      const event = {
        id: "WH-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: capture.value.captureId,
          status: "COMPLETED",
          amount: { currency_code: "USD", value: "50.00" },
          supplementary_data: { related_ids: { order_id: orderId } },
        },
      };

      const webhook = await harness.anonymous("/api/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "paypal-transmission-sig": "valid" },
        body: JSON.stringify(event),
      });

      expect(webhook.status).toBe(200);
      expect(lockedLines((await verses(harness))["Tharun"])).toEqual([false, false, true, true]);
      expect(lockedLines((await verses(other))["Tharun"])).toEqual([true, true, true, true]);
    });

    it("refuses to capture an order that was made for another visitor, and sends nothing", async () => {
      const harness = await seededHarness();
      const other = harness.newBrowser();
      const { orderId } = await json<{ orderId: string }>(await harness.post("/api/payments/orders", { friend: "Tharun", amountCents: 5_000 }));

      const captured = await other.post("/api/payments/capture", { orderId });

      expect(captured.status).toBe(422);
      expect(harness.paypal.receivedBy(seedFriendAccounts["Tharun"] ?? "")).toBe(0);
      expect((await verses(other))["Tharun"]?.payment).toMatchObject({ amountRepaidCents: 0 });
    });
  });
});
