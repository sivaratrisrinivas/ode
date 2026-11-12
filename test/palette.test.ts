import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_COLORS } from "../src/server/card-image.ts";

const CSS = readFileSync(new URL("../src/client/ode.css", import.meta.url), "utf8");
const ROOT = /:root\s*\{([^}]*)\}/;

/** The custom properties `:root` of the stylesheet defines with a hex colour, by name without the dashes. */
function rootTokens(): Map<string, string> {
  const root = ROOT.exec(CSS)?.[1] ?? "";
  return new Map([...root.matchAll(/--([\w-]+):\s*#([0-9a-fA-F]{6})\s*;/g)].map(([, name, hex]) => [name ?? "", (hex ?? "").toLowerCase()]));
}

describe("the share card's colours", () => {
  it("are the stylesheet's tokens: the card is drawn without CSS, so a changed token must change it too", () => {
    const tokens = rootTokens();
    for (const [name, hex] of Object.entries(CARD_COLORS)) {
      expect(tokens.get(name), `--${name} in ode.css`).toBe(hex);
    }
  });
});

describe("the stylesheet", () => {
  it("names each colour once: a colour literal outside :root is a token that has not been named", () => {
    const outside = CSS.replace(ROOT, "").replace(/url\("[^"]*"\)/g, "");
    expect(outside.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []).toEqual([]);
  });
});
