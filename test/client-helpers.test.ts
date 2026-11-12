import { describe, expect, it } from "vitest";
import { classNames, clamp01 } from "../src/client/helpers.ts";

describe("classNames", () => {
  it("joins what is a class and drops what is not", () => {
    expect(classNames("ode-line", false, undefined, null, "ode-line--hook")).toBe("ode-line ode-line--hook");
    expect(classNames(false, undefined)).toBeUndefined();
  });
});

describe("clamp01", () => {
  it("holds a value to 0 through 1, and a number that is not one to 0", () => {
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(7)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
