import { describe, expect, it } from "vitest";
import { chorusDropped, linesUnlocked, nextLineAtCents } from "../src/server/unlock.ts";

describe("lines unlocked", () => {
  // Tharun owes $97.50: each line is a quarter, $24.375.
  it.each([
    [0, 0],
    [2_437, 0],
    [2_438, 1],
    [5_000, 2],
    [7_313, 3],
    [9_749, 3],
    [9_750, 4],
  ])("$%s of $97.50 unlocks %s lines", (repaid, lines) => {
    expect(linesUnlocked(9_750, repaid)).toBe(lines);
  });

  it("never unlocks more than four lines", () => {
    expect(linesUnlocked(9_750, 20_000)).toBe(4);
  });

  it("unlocks lines by whole quarters even when an amount does not divide by four", () => {
    // Owed 3 cents: a quarter is 0.75 cents, so 1 cent unlocks one line, 2 cents two, and all 3 cents all four.
    expect([1, 2, 3].map((repaid) => linesUnlocked(3, repaid))).toEqual([1, 2, 4]);
  });
});

describe("the amount at which the next line unlocks", () => {
  it("rounds up to the cent, and paying exactly that unlocks the line", () => {
    const owed = 9_750;
    const next = nextLineAtCents(owed, 5_000);
    expect(next).toBe(7_313);
    expect(linesUnlocked(owed, 7_313)).toBe(3);
    expect(linesUnlocked(owed, 7_312)).toBe(2);
  });

  it("is the first quarter when nothing is repaid", () => {
    expect(nextLineAtCents(9_750, 0)).toBe(2_438);
  });

  it("is undefined once every line is unlocked", () => {
    expect(nextLineAtCents(9_750, 9_750)).toBeUndefined();
  });

  it.each([1, 2, 3, 7, 9_750, 12_345])("is always the least repaid amount that unlocks another line (owed %s)", (owed) => {
    for (let repaid = 0; repaid < owed; repaid += Math.max(1, Math.floor(owed / 37))) {
      const next = nextLineAtCents(owed, repaid);
      if (next === undefined) throw new Error("a line should be locked");
      expect(linesUnlocked(owed, next)).toBeGreaterThan(linesUnlocked(owed, repaid));
      expect(linesUnlocked(owed, next - 1)).toBe(linesUnlocked(owed, repaid));
    }
  });
});
