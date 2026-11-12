import { describe, expect, it } from "vitest";
import { ClaudeUnavailable, type Claude } from "../src/server/ports.ts";
import { err } from "../src/server/result.ts";
import { fakeClaude } from "../src/testing/fakes.ts";
import { createHarness } from "./harness.ts";
import { seedExtraction, seedNotes } from "../src/testing/seed.ts";

interface RowBody {
  friend: string;
  amountOwedCents: number | null;
  insideJoke: string;
  warnings: string[];
}
interface LedgerBody {
  notes: string;
  rows: RowBody[];
  warnings: string[];
}
interface ErrorBody {
  error: string;
}

// Response.json() is untyped, so assigning it to a declared type needs no cast.
async function json<T>(res: Response): Promise<T> {
  return res.json();
}

function extractedFriend(name: string, amountOwedCents: number | null, extra: object = {}) {
  return { name, amountOwedCents, amountIsEstimate: false, insideJoke: `${name}'s trip memory`, ...extra };
}

describe("trip notes become a ledger", () => {
  it("gives the seed notes Tharun $97.50, Vikram $82.50 and Sahiti $77.50, each with an inside joke", async () => {
    const { post } = await createHarness({ claude: fakeClaude({ [seedNotes.trim()]: seedExtraction }) });

    const res = await post("/api/ledger", { notes: seedNotes });

    expect(res.status).toBe(200);
    const { rows } = await json<LedgerBody>(res);
    expect(rows.map((r) => [r.friend, r.amountOwedCents])).toEqual([
      ["Tharun", 9750],
      ["Vikram", 8250],
      ["Sahiti", 7750],
    ]);
    for (const row of rows) expect(row.insideJoke).not.toBe("");
  });

  it("keeps edits to amount owed and inside joke after a reload", async () => {
    const { post, patch, get } = await createHarness({ claude: fakeClaude({ [seedNotes.trim()]: seedExtraction }) });
    await post("/api/ledger", { notes: seedNotes });

    const edited = await patch("/api/ledger/Vikram", { amountOwedCents: 9000, insideJoke: "The pier at 9pm" });
    expect(edited.status).toBe(200);

    const reloaded = await json<LedgerBody>(await get("/api/ledger"));
    expect(reloaded.rows.map((r) => [r.friend, r.amountOwedCents, r.insideJoke])).toEqual([
      ["Tharun", 9750, "Drove the overnight stretch to Key West while everyone slept"],
      ["Vikram", 9000, "The pier at 9pm"],
      ["Sahiti", 7750, "Screamed when the alligator came close to the boat"],
    ]);
  });

  it("proposes a number for a vague amount and warns until the payer edits it", async () => {
    const { post, patch, get } = await createHarness({ claude: fakeClaude({ "gas $90ish": { friends: [extractedFriend("Vikram", 9000, { amountIsEstimate: true })], groupCosts: [] } }) });

    const proposed = await json<LedgerBody>(await post("/api/ledger", { notes: "gas $90ish" }));
    expect(proposed.rows[0]?.amountOwedCents).toBe(9000);
    expect(proposed.rows[0]?.warnings).toEqual([expect.stringContaining("Vikram")]);

    await patch("/api/ledger/Vikram", { amountOwedCents: 8800 });
    const reloaded = await json<LedgerBody>(await get("/api/ledger"));
    expect(reloaded.rows[0]).toMatchObject({ amountOwedCents: 8800, warnings: [] });
  });

  it("rejects notes naming more than 3 friends, with a clear message, and keeps the current ledger", async () => {
    const four = { friends: ["Tharun", "Vikram", "Sahiti", "Priya"].map((n) => extractedFriend(n, 5000)), groupCosts: [] };
    const { post, get } = await createHarness({
      claude: fakeClaude({ [seedNotes.trim()]: seedExtraction, "four friends": four }),
    });
    await post("/api/ledger", { notes: seedNotes });

    const res = await post("/api/ledger", { notes: "four friends" });

    expect(res.status).toBe(422);
    const { error } = await json<ErrorBody>(res);
    expect(error).toContain("up to 3 friends");
    expect(error).toContain("Priya");
    const current = await json<LedgerBody>(await get("/api/ledger"));
    expect(current.rows.map((r) => r.friend)).toEqual(["Tharun", "Vikram", "Sahiti"]);
  });

  it("warns about a missing amount instead of showing zero, until the payer enters one", async () => {
    const { post, patch, get } = await createHarness({
      claude: fakeClaude({ "vikram did gas": { friends: [extractedFriend("Vikram", null)], groupCosts: [] } }),
    });

    const built = await json<LedgerBody>(await post("/api/ledger", { notes: "vikram did gas" }));
    expect(built.rows[0]).toMatchObject({ friend: "Vikram", amountOwedCents: null });
    expect(built.rows[0]?.warnings).toEqual([expect.stringContaining("No amount found for Vikram")]);

    await patch("/api/ledger/Vikram", { amountOwedCents: 4000 });
    const reloaded = await json<LedgerBody>(await get("/api/ledger"));
    expect(reloaded.rows[0]).toMatchObject({ amountOwedCents: 4000, warnings: [] });
  });

  it("warns on the ledger when no friend is found in the notes", async () => {
    const { post } = await createHarness({
      claude: fakeClaude({ "just vibes": { friends: [], groupCosts: [] } }),
    });

    const res = await post("/api/ledger", { notes: "just vibes" });

    expect(res.status).toBe(200);
    const body = await json<LedgerBody>(res);
    expect(body.rows).toEqual([]);
    expect(body.warnings).toEqual([expect.stringContaining("No friends found")]);
  });

  it("warns when a group cost has no amount and subtracts nothing for it", async () => {
    const { post } = await createHarness({
      claude: fakeClaude({
        "parking, no idea how much": {
          friends: [extractedFriend("Tharun", 10000)],
          groupCosts: [{ description: "Parking", amountCents: null }],
        },
      }),
    });

    const body = await json<LedgerBody>(await post("/api/ledger", { notes: "parking, no idea how much" }));

    expect(body.rows[0]?.amountOwedCents).toBe(10000);
    expect(body.warnings).toEqual([expect.stringContaining("Parking")]);
  });

  it("splits group costs evenly between the payer and each friend", async () => {
    const { post } = await createHarness({
      claude: fakeClaude({
        "two friends, $90 dinner": {
          friends: [extractedFriend("Tharun", 5000), extractedFriend("Vikram", 5000)],
          groupCosts: [{ description: "Dinner", amountCents: 9000 }],
        },
      }),
    });

    const body = await json<LedgerBody>(await post("/api/ledger", { notes: "two friends, $90 dinner" }));

    expect(body.rows.map((r) => r.amountOwedCents)).toEqual([2000, 2000]);
  });

  it("warns instead of showing zero when group costs cancel out what is owed", async () => {
    const { post } = await createHarness({
      claude: fakeClaude({
        "tiny debt": {
          friends: [extractedFriend("Tharun", 500)],
          groupCosts: [{ description: "Parking", amountCents: 3000 }],
        },
      }),
    });

    const body = await json<LedgerBody>(await post("/api/ledger", { notes: "tiny debt" }));

    expect(body.rows[0]?.amountOwedCents).toBeNull();
    expect(body.rows[0]?.warnings).toEqual([expect.stringContaining("Tharun")]);
  });

  it("replaces the ledger when new notes are posted", async () => {
    const { post, get } = await createHarness({
      claude: fakeClaude({
        [seedNotes.trim()]: seedExtraction,
        "just tharun": { friends: [extractedFriend("Tharun", 2500)], groupCosts: [] },
      }),
    });
    await post("/api/ledger", { notes: seedNotes });

    await post("/api/ledger", { notes: "just tharun" });

    const current = await json<LedgerBody>(await get("/api/ledger"));
    expect(current.notes).toBe("just tharun");
    expect(current.rows.map((r) => [r.friend, r.amountOwedCents])).toEqual([["Tharun", 2500]]);
  });

  it("starts with an empty ledger", async () => {
    const { get } = await createHarness();

    const body = await json<LedgerBody>(await get("/api/ledger"));

    expect(body).toEqual({ notes: "", rows: [], warnings: [] });
  });

  it("asks the payer to try again when Claude is unavailable, and keeps the current ledger", async () => {
    const working = fakeClaude({ [seedNotes.trim()]: seedExtraction });
    let down = false;
    const claude: Claude = {
      structured: async (request) => (down ? err(new ClaudeUnavailable("rate limited")) : working.structured(request)),
    };
    const { post, get } = await createHarness({ claude });
    await post("/api/ledger", { notes: seedNotes });
    down = true;

    const res = await post("/api/ledger", { notes: "anything" });

    expect(res.status).toBe(502);
    expect((await json<ErrorBody>(res)).error).toContain("Try again");
    const current = await json<LedgerBody>(await get("/api/ledger"));
    expect(current.rows).toHaveLength(3);
  });

  it("asks the payer to try again when Claude returns an impossible amount, and keeps the current ledger", async () => {
    const huge = { friends: [extractedFriend("Tharun", 99_999_999_999)], groupCosts: [] };
    const { post, get } = await createHarness({
      claude: fakeClaude({ [seedNotes.trim()]: seedExtraction, "a million billion": huge }),
    });
    await post("/api/ledger", { notes: seedNotes });

    const res = await post("/api/ledger", { notes: "a million billion" });

    expect(res.status).toBe(502);
    const current = await json<LedgerBody>(await get("/api/ledger"));
    expect(current.rows).toHaveLength(3);
  });

  it("refuses empty notes, and edits that are not an amount or a joke", async () => {
    const { post, patch } = await createHarness({ claude: fakeClaude({ [seedNotes.trim()]: seedExtraction }) });
    await post("/api/ledger", { notes: seedNotes });

    expect((await post("/api/ledger", { notes: "   " })).status).toBe(422);
    expect((await post("/api/ledger", {})).status).toBe(422);
    expect((await patch("/api/ledger/Vikram", {})).status).toBe(422);
    expect((await patch("/api/ledger/Vikram", { amountOwedCents: 0 })).status).toBe(422);
    expect((await patch("/api/ledger/Vikram", { amountOwedCents: 12.5 })).status).toBe(422);
    expect((await patch("/api/ledger/Vikram", { amountOwedCents: "90" })).status).toBe(422);
  });

  it("answers 404 when editing a friend who is not on the ledger", async () => {
    const { patch } = await createHarness();

    const res = await patch("/api/ledger/Nobody", { amountOwedCents: 100 });

    expect(res.status).toBe(404);
  });
});
