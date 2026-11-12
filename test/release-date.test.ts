import { describe, expect, it } from "vitest";
import { parseReleaseDate } from "../src/server/release-date.ts";
import { fakeClaudeByTask } from "../src/testing/fakes.ts";
import { createHarness, pollUntil } from "./harness.ts";
import { seedExtraction, seedLyrics, seedNotes } from "../src/testing/seed.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What both pages are told about the release date of a ready Ode. */
interface ReadyOde {
  status: string;
  dropped: boolean;
  release: { date: string; daysToDrop: number | null; delayed: boolean; countdown: string | null } | null;
  sections: { kind: string; friend?: string; locked?: boolean; friendViewPath?: string }[];
}

async function json<T>(res: Response): Promise<T> {
  return res.json();
}

/** The seed ledger (three friends; the fake clock reads Mon Nov 9 2026) with lyrics written, the Ode not yet made. */
async function withLyrics() {
  const harness = await createHarness({
    claude: fakeClaudeByTask({ "extract-ledger": () => seedExtraction, "write-lyrics": () => seedLyrics }),
  });
  await harness.post("/api/ledger", { notes: seedNotes });
  await harness.post("/api/lyrics", {});
  return harness;
}

type Harness = Awaited<ReturnType<typeof withLyrics>>;

async function makeOde(harness: Harness, body: unknown) {
  const res = await harness.post("/api/ode", body);
  expect(res.status).toBe(202);
  await pollUntil(
    async () => json<{ status: string }>(await harness.get("/api/ode")),
    (ode) => ode.status === "ready",
  );
}

async function madeOde(releaseDate = "2026-12-01") {
  const harness = await withLyrics();
  await makeOde(harness, { releaseDate });
  return harness;
}

const payerOde = async (harness: Harness) => json<ReadyOde>(await harness.get("/api/ode"));

async function friendOde(harness: Harness, friend: string): Promise<ReadyOde> {
  const link = (await payerOde(harness)).sections.find((section) => section.friend === friend)?.friendViewPath ?? "";
  return (await json<{ ode: ReadyOde }>(await harness.get(link.replace("/f/", "/api/friends/")))).ode;
}

async function pay(harness: Harness, friend: string, amountCents: number) {
  const { orderId } = await json<{ orderId: string }>(await harness.post("/api/payments/orders", { friend, amountCents }));
  expect((await harness.post("/api/payments/capture", { orderId })).status).toBe(200);
}

/** Both readers of the same Ode. */
async function readers(harness: Harness): Promise<ReadyOde[]> {
  return [await payerOde(harness), await friendOde(harness, "Tharun")];
}

const chorusOf = (ode: ReadyOde) => ode.sections.find((section) => section.kind === "chorus");

describe("the release date", () => {
  it("shows the countdown to the payer and every friend: friends repaid of all friends, and the days left", async () => {
    const harness = await madeOde("2026-12-01");

    for (const ode of await readers(harness)) {
      expect(ode.release).toEqual({ date: "2026-12-01", daysToDrop: 22, delayed: false, countdown: "0 of 3 friends · 22 days to drop" });
    }

    await pay(harness, "Tharun", 9_750);
    for (const ode of await readers(harness)) expect(ode.release?.countdown).toBe("1 of 3 friends · 22 days to drop");
  });

  it("counts down by whole days as the clock moves, and says so on the last two", async () => {
    const harness = await madeOde("2026-11-12");
    expect((await payerOde(harness)).release?.countdown).toBe("0 of 3 friends · 3 days to drop");

    harness.clock.advance(2 * DAY_MS);
    expect((await payerOde(harness)).release?.countdown).toBe("0 of 3 friends · 1 day to drop");

    harness.clock.advance(DAY_MS);
    expect((await payerOde(harness)).release?.countdown).toBe("0 of 3 friends · drops today");
  });

  it("is delayed once the date has passed with a friend unpaid, and the chorus stays locked, for the payer and every friend", async () => {
    const harness = await madeOde("2026-11-12");
    await pay(harness, "Tharun", 9_750);
    await pay(harness, "Vikram", 8_250);
    await pay(harness, "Sahiti", 7_749);

    // The release day itself is not yet late.
    harness.clock.set(new Date("2026-11-12T23:59:00.000Z"));
    expect((await payerOde(harness)).release?.delayed).toBe(false);

    harness.clock.set(new Date("2026-11-13T00:00:00.000Z"));
    for (const ode of await readers(harness)) {
      expect(ode.release?.delayed).toBe(true);
      expect(ode.release?.countdown).toBe("Delayed · 2 of 3 friends repaid · was due 2026-11-12");
      expect(ode.dropped).toBe(false);
      expect(chorusOf(ode)?.locked).toBe(true);
    }
  });

  it("is no longer delayed, and the chorus drops, when the last friend is repaid after the date", async () => {
    const harness = await madeOde("2026-11-12");
    harness.clock.set(new Date("2026-11-20T00:00:00.000Z"));
    await pay(harness, "Tharun", 9_750);
    await pay(harness, "Vikram", 8_250);
    expect((await payerOde(harness)).release?.delayed).toBe(true);

    await pay(harness, "Sahiti", 7_750);

    for (const ode of await readers(harness)) {
      expect(ode.release).toMatchObject({ delayed: false, daysToDrop: null, countdown: null });
      expect(ode.dropped).toBe(true);
      expect(chorusOf(ode)?.locked).toBe(false);
    }
  });

  it("cannot be changed once the Ode is made: a second request with another date is refused and the date stands", async () => {
    const harness = await madeOde("2026-12-01");

    const again = await harness.post("/api/ode", { releaseDate: "2027-01-01" });

    expect(again.status).toBe(409);
    expect((await payerOde(harness)).release?.date).toBe("2026-12-01");
    expect((await harness.patch("/api/ode", { releaseDate: "2027-01-01" })).status).toBe(404);
    expect((await payerOde(harness)).release?.date).toBe("2026-12-01");
  });

  it("answers an Ode already made before judging a new date", async () => {
    const harness = await madeOde("2026-12-01");

    expect((await harness.post("/api/ode", { releaseDate: "someday" })).status).toBe(409);
  });

  it.each([["someday"], ["2026-02-30"], ["12/01/2026"], [20261201], [null], ["2026-11-08"]])(
    "refuses the release date %j and starts nothing",
    async (releaseDate) => {
      const harness = await withLyrics();

      const res = await harness.post("/api/ode", { releaseDate });

      expect(res.status).toBe(422);
      expect(await json<{ error: string }>(res)).toEqual({ error: expect.stringMatching(/release date/i) });
      expect(await json<{ status: string }>(await harness.get("/api/ode"))).toEqual({ status: "none" });
    },
  );

  it("requires a release date: a request without one is refused and starts nothing", async () => {
    const harness = await withLyrics();

    for (const body of [{}, { releaseDate: "" }]) {
      const res = await harness.post("/api/ode", body);
      expect(res.status).toBe(422);
      expect(await json<{ error: string }>(res)).toEqual({ error: expect.stringMatching(/release date/i) });
    }
    expect(await json<{ status: string }>(await harness.get("/api/ode"))).toEqual({ status: "none" });
  });

  it("answers an Ode already made, or a run in progress, before asking for the date", async () => {
    const harness = await madeOde("2026-12-01");

    expect((await harness.post("/api/ode", {})).status).toBe(409);
  });

  it("accepts today as the release date", async () => {
    const harness = await madeOde("2026-11-09");

    expect((await payerOde(harness)).release?.countdown).toBe("0 of 3 friends · drops today");
  });
});

describe("parsing a release date", () => {
  const now = new Date("2026-11-09T15:00:00.000Z");

  it("takes a calendar date from today on", () => {
    expect(parseReleaseDate("2026-11-09", now)._tag).toBe("ok");
    expect(parseReleaseDate("2028-02-29", now)._tag).toBe("ok");
  });

  it.each(["2027-02-29", "2026-13-01", "2026-1-1", " 2026-12-01", "2026-12-01T00:00:00Z", ""])("rejects %j", (text) => {
    expect(parseReleaseDate(text, now)._tag).toBe("err");
  });
});
