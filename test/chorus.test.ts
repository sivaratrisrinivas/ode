import { describe, expect, it } from "vitest";
import { fakeClaudeByTask } from "../src/testing/fakes.ts";
import { createHarness, MAKE_ODE, pollUntil } from "./harness.ts";
import { seedExtraction, seedLyrics, seedNotes } from "../src/testing/seed.ts";

/** What the payer's page and a friend's page are both told about a ready Ode's finish. */
interface ReadyOde {
  status: string;
  trip: string;
  dropped: boolean;
  sections: { kind: string; friend?: string; locked?: boolean; friendViewPath?: string }[];
}
interface FriendView {
  ode: ReadyOde;
}

async function json<T>(res: Response): Promise<T> {
  return res.json();
}

/** The seed ledger (Tharun owes $97.50, Vikram $82.50, Sahiti $77.50, trip "Florida '25") with its Ode made. */
async function madeOde(extraction: object = seedExtraction) {
  const harness = await createHarness({
    claude: fakeClaudeByTask({ "extract-ledger": () => extraction, "write-lyrics": () => seedLyrics }),
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

type Harness = Awaited<ReturnType<typeof madeOde>>;

async function payerOde(harness: Harness): Promise<ReadyOde> {
  return json<ReadyOde>(await harness.get("/api/ode"));
}

/** A friend's page as that friend sees it; the link is the one the payer's page shows. */
async function friendView(harness: Harness, friend: string): Promise<FriendView> {
  const link = (await payerOde(harness)).sections.find((section) => section.friend === friend)?.friendViewPath ?? "";
  return json<FriendView>(await harness.get(link.replace("/f/", "/api/friends/")));
}

async function pay(harness: Harness, friend: string, amountCents: number) {
  const { orderId } = await json<{ orderId: string }>(await harness.post("/api/payments/orders", { friend, amountCents }));
  const res = await harness.post("/api/payments/capture", { orderId });
  expect(res.status).toBe(200);
}

const chorusOf = (ode: ReadyOde) => ode.sections.find((section) => section.kind === "chorus");

/** Both readers of the same Ode: the payer's page and one friend's. */
async function readers(harness: Harness): Promise<ReadyOde[]> {
  return [await payerOde(harness), (await friendView(harness, "Tharun")).ode, (await friendView(harness, "Sahiti")).ode];
}

describe("the chorus", () => {
  it("is locked, for the payer and every friend, before anyone is paid", async () => {
    const harness = await madeOde();

    for (const ode of await readers(harness)) {
      expect(chorusOf(ode)?.locked).toBe(true);
      expect(ode.dropped).toBe(false);
    }
  });

  it("stays locked while any friend is not fully repaid, even with every other friend repaid and the last one a cent short", async () => {
    const harness = await madeOde();
    await pay(harness, "Tharun", 9_750);
    await pay(harness, "Vikram", 8_250);
    await pay(harness, "Sahiti", 7_749);

    for (const ode of await readers(harness)) {
      expect(chorusOf(ode)?.locked).toBe(true);
      expect(ode.dropped).toBe(false);
    }
  });

  it("drops on the last full repayment, for the payer and every friend, with the trip's name", async () => {
    const harness = await madeOde();
    await pay(harness, "Tharun", 9_750);
    await pay(harness, "Vikram", 8_250);
    await pay(harness, "Sahiti", 7_000);
    expect(chorusOf(await payerOde(harness))?.locked).toBe(true);

    await pay(harness, "Sahiti", 750);

    for (const ode of await readers(harness)) {
      expect(chorusOf(ode)?.locked).toBe(false);
      expect(ode.dropped).toBe(true);
      expect(ode.trip).toBe("Florida '25");
    }
  });

  it("reaches a friend's open view the moment the last payment is recorded", async () => {
    const harness = await madeOde();
    await pay(harness, "Tharun", 9_750);
    await pay(harness, "Vikram", 8_250);
    const link = (await payerOde(harness)).sections.find((section) => section.friend === "Sahiti")?.friendViewPath ?? "";
    const events = await harness.get(`${link.replace("/f/", "/api/friends/")}/events`);
    const reader = events.body?.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    const nextState = async (): Promise<FriendView> => {
      for (;;) {
        const end = seen.indexOf("\n\n");
        if (end >= 0) {
          const block = seen.slice(0, end);
          seen = seen.slice(end + 2);
          const data = block.split("\n").find((line) => line.startsWith("data: "));
          if (data !== undefined) return JSON.parse(data.slice("data: ".length));
          continue;
        }
        const chunk = await Promise.race([reader?.read(), new Promise<undefined>((resolve) => setTimeout(resolve, 1_000))]);
        if (chunk === undefined || chunk.done) throw new Error("no state event arrived in time");
        seen += decoder.decode(chunk.value, { stream: true });
      }
    };

    expect((await nextState()).ode.dropped).toBe(false);
    await pay(harness, "Sahiti", 7_750);
    const after = await nextState();
    await reader?.cancel();

    expect(after.ode.dropped).toBe(true);
    expect(chorusOf(after.ode)?.locked).toBe(false);
  });

  it("names the trip generically when the notes gave Claude no name for it", async () => {
    const { trip: _named, ...unnamed } = seedExtraction;
    const harness = await madeOde(unnamed);

    expect((await payerOde(harness)).trip).toBe("Our trip");
  });
});
