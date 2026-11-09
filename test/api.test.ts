import { describe, expect, it } from "vitest";
import { createHarness } from "./harness.ts";

describe("walking skeleton API", () => {
  it("serves the hard-coded ledger row from Postgres", async () => {
    const { get } = await createHarness();

    const res = await get("/api/ledger");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rows: [
        {
          friend: "Tharun",
          amountOwedCents: 9750,
          insideJoke: "Drove the overnight stretch to Key West while everyone slept",
        },
      ],
    });
  });

  it("reports the time from the controllable clock", async () => {
    const { get, clock } = await createHarness();
    clock.set(new Date("2026-12-01T09:30:00.000Z"));

    const res = await get("/api/health");

    expect(await res.json()).toEqual({ ok: true, now: "2026-12-01T09:30:00.000Z" });
  });

  it("answers unknown API paths with 404, not the SPA page", async () => {
    const { get } = await createHarness();

    const res = await get("/api/nope");

    expect(res.status).toBe(404);
  });
});
