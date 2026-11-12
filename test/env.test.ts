import { describe, expect, it } from "vitest";
import { readEnv } from "../src/ops/env.ts";

describe("reading the variables a command needs", () => {
  it("returns every value by name", () => {
    expect(readEnv(["A", "B"], { A: "1", B: "2", C: "3" })).toEqual({ _tag: "ok", value: { A: "1", B: "2" } });
  });

  it("names every variable that is unset or empty, and never a value", () => {
    const read = readEnv(["A", "B", "C"], { A: "secret", B: "" });

    expect(read._tag === "err" && read.error._tag).toBe("MissingEnv");
    expect(read._tag === "err" && read.error.names).toEqual(["B", "C"]);
    expect(read._tag === "err" && read.error.message).toContain("B, C are not set");
    expect(read._tag === "err" && read.error.message).not.toContain("secret");
  });
});
