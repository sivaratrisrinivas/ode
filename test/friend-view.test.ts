import { describe, expect, it } from "vitest";
import { fakeClaudeByTask } from "../src/testing/fakes.ts";
import { createHarness, MAKE_ODE, pollUntil } from "./harness.ts";
import { seedExtraction, seedLyrics, seedNotes } from "../src/testing/seed.ts";

interface Standing {
  amountOwedCents: number;
  amountRepaidCents: number;
  linesUnlocked: number;
  nextLineAtCents: number | null;
}
interface VerseBody {
  kind: "verse";
  friend: string;
  lines: { text: string; locked: boolean }[];
  payment: Standing | null;
  friendViewPath?: string;
}
interface FriendViewBody {
  friend: string;
  you: Standing | null;
  ode: { status: string; audioUrl?: string; sections?: { kind: string }[] };
}

async function json<T>(res: Response): Promise<T> {
  return res.json();
}

/** The seed ledger with lyrics written, optionally with the Ode made. */
async function ledgerHarness({ makeOde }: { makeOde: boolean }) {
  const harness = await createHarness({
    claude: fakeClaudeByTask({ "extract-ledger": () => seedExtraction, "write-lyrics": () => seedLyrics }),
  });
  await harness.post("/api/ledger", { notes: seedNotes });
  await harness.post("/api/lyrics", {});
  if (makeOde) {
    await harness.post("/api/ode", MAKE_ODE);
    await pollUntil(
      async () => json<{ status: string }>(await harness.get("/api/ode")),
      (ode) => ode.status === "ready",
    );
  }
  return harness;
}

type Harness = Awaited<ReturnType<typeof ledgerHarness>>;

/** Each friend's private link path, as the payer's page shows it. */
async function links(harness: Pick<Harness, "get">): Promise<Record<string, string>> {
  const ode = await json<{ sections: (VerseBody | { kind: string })[] }>(await harness.get("/api/ode"));
  const found = ode.sections.flatMap((section) => (section.kind === "verse" ? [section as VerseBody] : []));
  return Object.fromEntries(found.map((verse) => [verse.friend, verse.friendViewPath ?? ""]));
}

/** The API path behind a friend's page link: `/f/<token>` is the page, `/api/friends/<token>` its data. */
const apiPath = (link: string) => link.replace("/f/", "/api/friends/");

async function viewFor(harness: Pick<Harness, "get">, friend: string): Promise<FriendViewBody> {
  const link = (await links(harness))[friend];
  return json<FriendViewBody>(await harness.get(apiPath(link ?? "")));
}

async function pay(harness: Pick<Harness, "post">, friend: string, amountCents: number) {
  const { orderId } = await json<{ orderId: string }>(await harness.post("/api/payments/orders", { friend, amountCents }));
  return harness.post("/api/payments/capture", { orderId });
}

const lockedLines = (view: FriendViewBody, friend: string) => {
  const verse = view.ode.sections?.find((section): section is VerseBody => section.kind === "verse" && (section as VerseBody).friend === friend);
  return verse?.lines.map((line) => line.locked);
};

/** An open event stream: `next` waits for the following state event, `close` is the friend leaving the page. */
function openEvents(res: Response) {
  const reader = res.body?.getReader();
  if (reader === undefined) throw new Error("the event stream has no body");
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(withinMs = 1_000): Promise<FriendViewBody> {
      const deadline = Date.now() + withinMs;
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = block.split("\n").find((line) => line.startsWith("data: "));
          if (block.includes("event: state") && data !== undefined) return JSON.parse(data.slice("data: ".length));
          continue;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("no state event arrived in time");
        const chunk = await Promise.race([
          reader.read(),
          new Promise<undefined>((resolve) => setTimeout(resolve, remaining)),
        ]);
        if (chunk === undefined) throw new Error("no state event arrived in time");
        if (chunk.done) throw new Error("the event stream ended");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    close: () => reader.cancel(),
  };
}

const THARUN = "Tharun";
const VIKRAM = "Vikram";

describe("the friend view", () => {
  it("shows a friend only their own amounts, and no other friend's amount anywhere in the response", async () => {
    const harness = await ledgerHarness({ makeOde: true });
    await pay(harness, VIKRAM, 4_000);
    const link = (await links(harness))[THARUN] ?? "";

    const res = await harness.get(apiPath(link));
    const text = await res.text();
    const view: FriendViewBody = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(view.friend).toBe(THARUN);
    expect(view.you).toEqual({ amountOwedCents: 9_750, amountRepaidCents: 0, linesUnlocked: 0, nextLineAtCents: 2_438 });
    // Amounts appear once in `you` and once on Tharun's own verse, and nowhere else; no other friend's link reaches him either.
    expect(text.match(/"amountOwedCents"/g)).toHaveLength(2);
    expect(text.match(/"amountRepaidCents"/g)).toHaveLength(2);
    expect(text).not.toContain("8250");
    expect(text).not.toContain("7750");
    for (const other of Object.values(await links(harness)).filter((candidate) => candidate !== link)) {
      expect(text).not.toContain(other.replace("/f/", ""));
    }
    const verses = (view.ode.sections ?? []).filter((section): section is VerseBody => section.kind === "verse");
    expect(verses.filter((verse) => verse.payment !== null).map((verse) => verse.friend)).toEqual([THARUN]);
  });

  it("plays the whole Ode: every verse, with each friend's lines shown as locked or unlocked", async () => {
    const harness = await ledgerHarness({ makeOde: true });
    await pay(harness, VIKRAM, 4_125);

    const view = await viewFor(harness, THARUN);

    expect(view.ode.status).toBe("ready");
    expect(view.ode.audioUrl).toMatch(/^\/api\/friends\/[0-9a-f]{64}\/audio$/);
    expect(view.ode.sections?.map((section) => section.kind)).toEqual(["intro", "verse", "hook", "verse", "hook", "verse", "hook", "chorus"]);
    expect(lockedLines(view, THARUN)).toEqual([true, true, true, true]);
    expect(lockedLines(view, VIKRAM)).toEqual([false, false, true, true]);
    expect(lockedLines(view, "Sahiti")).toEqual([true, true, true, true]);
  });

  it("does not change a friend's own amounts when somebody else is paid", async () => {
    const harness = await ledgerHarness({ makeOde: true });

    await pay(harness, VIKRAM, 8_250);

    expect((await viewFor(harness, THARUN)).you).toMatchObject({ amountRepaidCents: 0, linesUnlocked: 0 });
    expect((await viewFor(harness, VIKRAM)).you).toMatchObject({ amountRepaidCents: 8_250, linesUnlocked: 4, nextLineAtCents: null });
  });

  it("shows the friend's amounts before the Ode is made, with nothing to play yet", async () => {
    const harness = await ledgerHarness({ makeOde: false });
    // No Ode yet, so the payer's page has no links: the link comes from the ledger.
    const link = (await json<{ rows: { friend: string; friendViewPath: string }[] }>(await harness.get("/api/ledger"))).rows.find((row) => row.friend === THARUN)?.friendViewPath;

    const view = await json<FriendViewBody>(await harness.get(apiPath(link ?? "")));

    expect(view.you).toMatchObject({ amountOwedCents: 9_750 });
    expect(view.ode).toEqual({ status: "none" });
  });

  it("keeps a friend's link when the payer edits the ledger, and ends it when the ledger is built again", async () => {
    const harness = await ledgerHarness({ makeOde: true });
    const link = (await links(harness))[THARUN] ?? "";

    await harness.patch(`/api/ledger/${THARUN}`, { amountOwedCents: 12_000 });
    const edited = await harness.get(apiPath(link));
    expect(edited.status).toBe(200);
    expect((await json<FriendViewBody>(edited)).you?.amountOwedCents).toBe(12_000);

    await harness.post("/api/ledger", { notes: seedNotes });
    expect((await harness.get(apiPath(link))).status).toBe(404);
  });

  it("gives each friend a different link that works after a restart of the web service", async () => {
    const harness = await ledgerHarness({ makeOde: true });
    const before = await links(harness);

    const restarted = harness.restartWebService();

    expect(new Set(Object.values(before)).size).toBe(3);
    expect(await links(restarted)).toEqual(before);
    expect((await restarted.get(apiPath(before[THARUN] ?? ""))).status).toBe(200);
  });

  it("answers an unknown link with not found, whatever it looks like", async () => {
    const harness = await ledgerHarness({ makeOde: true });
    const real = (await links(harness))[THARUN] ?? "";

    for (const token of ["nope", "0".repeat(64), `${real.replace("/f/", "")}x`, "%00", "..%2Fode"]) {
      expect((await harness.get(`/api/friends/${token}`)).status).toBe(404);
      expect((await harness.get(`/api/friends/${token}/events`)).status).toBe(404);
    }
  });

  describe("live updates", () => {
    it("opens with the current state, then pushes the unlock within a second of the payment", async () => {
      const harness = await ledgerHarness({ makeOde: true });
      const link = apiPath((await links(harness))[THARUN] ?? "");
      const events = await harness.get(`${link}/events`);
      expect(events.status).toBe(200);
      expect(events.headers.get("content-type")).toContain("text/event-stream");
      const open = openEvents(events);

      const first = await open.next();
      expect(first.you).toMatchObject({ amountRepaidCents: 0, linesUnlocked: 0 });
      expect(lockedLines(first, THARUN)).toEqual([true, true, true, true]);

      const paidAt = Date.now();
      await pay(harness, THARUN, 5_000);
      const pushed = await open.next();

      expect(Date.now() - paidAt).toBeLessThan(1_000);
      expect(pushed.you).toMatchObject({ amountRepaidCents: 5_000, linesUnlocked: 2 });
      expect(lockedLines(pushed, THARUN)).toEqual([false, false, true, true]);
      await open.close();
    });

    it("pushes an unlock that comes from the capture webhook, with no capture response", async () => {
      const harness = await ledgerHarness({ makeOde: true });
      const open = openEvents(await harness.get(`${apiPath((await links(harness))[THARUN] ?? "")}/events`));
      await open.next();

      const { orderId } = await json<{ orderId: string }>(await harness.post("/api/payments/orders", { friend: THARUN, amountCents: 5_000 }));
      const capture = await harness.paypal.captureOrder(orderId);
      if (capture._tag === "err" || capture.value.status !== "COMPLETED") throw new Error("the fake PayPal did not complete the capture");
      await harness.post(
        "/api/payments/webhook",
        {
          id: `WH-${capture.value.captureId}`,
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          resource: {
            id: capture.value.captureId,
            status: "COMPLETED",
            amount: { currency_code: "USD", value: "50.00" },
            supplementary_data: { related_ids: { order_id: orderId } },
          },
        },
        { "paypal-transmission-sig": "valid" },
      );

      expect(lockedLines(await open.next(), THARUN)).toEqual([false, false, true, true]);
      await open.close();
    });

    it("shows a friend another friend's unlock as an unlocked line, without that friend's amounts", async () => {
      const harness = await ledgerHarness({ makeOde: true });
      const open = openEvents(await harness.get(`${apiPath((await links(harness))[THARUN] ?? "")}/events`));
      await open.next();

      await pay(harness, VIKRAM, 4_125);
      const pushed = await open.next();

      expect(lockedLines(pushed, VIKRAM)).toEqual([false, false, true, true]);
      expect(pushed.you).toMatchObject({ amountRepaidCents: 0 });
      expect(JSON.stringify(pushed)).not.toContain("4125");
      await open.close();
    });

    it("sends nothing new while nothing changes", async () => {
      const harness = await ledgerHarness({ makeOde: true });
      const open = openEvents(await harness.get(`${apiPath((await links(harness))[THARUN] ?? "")}/events`));
      await open.next();

      await expect(open.next(1_500)).rejects.toThrow("no state event arrived in time");
      await open.close();
    });

    it("shows the current state to a view that reconnects after missing a payment", async () => {
      const harness = await ledgerHarness({ makeOde: true });
      const link = apiPath((await links(harness))[THARUN] ?? "");
      const dropped = openEvents(await harness.get(`${link}/events`));
      await dropped.next();
      await dropped.close();

      await pay(harness, THARUN, 5_000);
      const reconnected = openEvents(await harness.get(`${link}/events`));

      const first = await reconnected.next();
      expect(first.you).toMatchObject({ amountRepaidCents: 5_000, linesUnlocked: 2 });
      expect(lockedLines(first, THARUN)).toEqual([false, false, true, true]);
      expect(first).toEqual(await json(await harness.get(link)));
      await reconnected.close();
    });

    it("reaches a view held open on another web service process", async () => {
      const harness = await ledgerHarness({ makeOde: true });
      const other = harness.restartWebService();
      const open = openEvents(await other.get(`${apiPath((await links(harness))[THARUN] ?? "")}/events`));
      await open.next();

      await pay(harness, THARUN, 5_000);

      expect(lockedLines(await open.next(), THARUN)).toEqual([false, false, true, true]);
      await open.close();
    });

    it("shows the Ode to a view that was open before the Ode was made", async () => {
      const harness = await ledgerHarness({ makeOde: false });
      const link = apiPath((await json<{ rows: { friend: string; friendViewPath: string }[] }>(await harness.get("/api/ledger"))).rows.find((row) => row.friend === THARUN)?.friendViewPath ?? "");
      const open = openEvents(await harness.get(`${link}/events`));
      expect((await open.next()).ode.status).toBe("none");

      await harness.post("/api/ode", MAKE_ODE);

      const ready = await pollUntil(
        () => open.next(5_000),
        (view) => view.ode.status === "ready",
      );
      expect(ready.ode.sections?.length).toBe(8);
      await open.close();
    });
  });
});
