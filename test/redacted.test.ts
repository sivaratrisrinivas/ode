import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { Redacted } from "../src/server/redacted.ts";

describe("a redacted secret", () => {
  const secret = new Redacted("sk-live-0123456789");

  it("gives the secret back only to the caller that asks for it", () => {
    expect(Redacted.reveal(secret)).toBe("sk-live-0123456789");
  });

  it.each([
    ["JSON", (value: unknown) => JSON.stringify({ value })],
    ["a string", (value: unknown) => `${String(value)}`],
    ["a template literal", (value: unknown) => `key=${value}`],
    ["the inspector, as console.log uses it", (value: unknown) => inspect({ value })],
  ])("does not show the secret in %s", (_how, render) => {
    expect(render(secret)).not.toContain("0123456789");
  });
});
