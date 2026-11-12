import { describe, expect, it } from "vitest";
import { voiceLabels } from "../src/server/voice.ts";

describe("the voice label", () => {
  it("says 'in my voice' for the payer's voice by default, and nothing for Eleven Music's", () => {
    expect(voiceLabels(undefined)).toEqual({ "eleven-music": null, payer: "in my voice" });
    expect(voiceLabels("")).toEqual({ "eleven-music": null, payer: "in my voice" });
  });

  it("says 'a voice like mine' when VOICE_LABEL is like", () => {
    expect(voiceLabels("like")).toEqual({ "eleven-music": null, payer: "a voice like mine" });
  });
});
