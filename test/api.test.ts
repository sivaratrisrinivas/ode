import { describe, expect, it } from "vitest";
import { createHarness } from "./harness.ts";

describe("service basics", () => {
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
