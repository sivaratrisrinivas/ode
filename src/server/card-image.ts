import { crc32, deflateSync, gunzipSync } from "node:zlib";
import { GLYPH_HEIGHT, GLYPH_WIDTH, TERMINUS_GLYPHS_GZIP_BASE64 } from "./terminus-font.ts";

/** The size chat apps ask of a link-preview image: 1.91 to 1. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/**
 * The card's colours as six hex characters, each under the name of the stylesheet token (`--card` in `ode.css`) it must equal.
 * The card is drawn without CSS, so it cannot read the tokens; `test/palette.test.ts` fails when one drifts from its token.
 */
export const CARD_COLORS = {
  card: "fcf9f1",
  ink: "1e1a15",
  tape: "ffcc2e",
  "tape-brown": "5a3d24",
  "paper-deep": "e8dec9",
  coral: "e4533a",
} as const;

/** The PNG's palette, in the order of the indexes below. */
const PALETTE_ORDER = ["card", "ink", "tape", "tape-brown", "paper-deep", "coral"] as const satisfies readonly (keyof typeof CARD_COLORS)[];
const PALETTE = Uint8Array.from(PALETTE_ORDER.flatMap((name) => [0, 2, 4].map((start) => Number.parseInt(CARD_COLORS[name].slice(start, start + 2), 16))));

/** Palette indexes: the position of each colour in `PALETTE_ORDER`. */
const PAPER = 0;
const INK = 1;
const TAPE = 2;
const TAPE_BROWN = 3;
const WINDOW = 4;
const CORAL = 5;

/** Space kept clear on each side of the text. */
const MARGIN = 80;

/** The card's frame: the ink border's width, the tape band along the top and the ink rule under it. */
const BORDER = 16;
const BAND_HEIGHT = 56;
const RULE_HEIGHT = 8;

/** Where the headline starts from the top, and the space between it and the subline. */
const HEADLINE_TOP = 150;
const HEADLINE_GAP = 40;

/** The cassette's shell, centred across the card: its top edge, size and corner radius. */
const SHELL_TOP = 392;
const SHELL_WIDTH = 520;
const SHELL_HEIGHT = 200;
const SHELL_RADIUS = 26;

/** The paper label on the shell: its inset from the shell's sides, top edge, size and corner radius, the tape stripe along its foot and the coral tab at its corner. */
const LABEL_INSET = 24;
const LABEL_TOP = 408;
const LABEL_HEIGHT = 58;
const LABEL_RADIUS = 10;
const STRIPE_HEIGHT = 10;
const TAB_WIDTH = 14;

/** The window under the label (its inset from the shell's sides, top edge and height; its ends are round) and the two reels in it: their centre line and each side's distance from the card's middle, and the radii of the tape pack, the hub and the spindle. */
const WINDOW_INSET = 40;
const WINDOW_TOP = 482;
const WINDOW_HEIGHT = 84;
const REEL_CENTER_Y = 524;
const REEL_SPACING = 100;
const PACK_RADIUS = 38;
const HUB_RADIUS = 22;
const SPINDLE_RADIUS = 8;

const glyphs = gunzipSync(Buffer.from(TERMINUS_GLYPHS_GZIP_BASE64, "base64"));

/** The glyphs of the Latin-9 set that are not the Unicode character of the same number. */
const LATIN_9: Readonly<Record<string, number>> = { "€": 0xa4, "Š": 0xa6, "š": 0xa8, "Ž": 0xb4, "ž": 0xb8, "Œ": 0xbc, "œ": 0xbd, "Ÿ": 0xbe };

/** The Latin-1 characters whose slot Latin-9 gave to another character. */
const LATIN_9_SLOTS = new Set(Object.values(LATIN_9));

/** The glyph for a character; "?" for one the font has no glyph for. */
function glyphFor(character: string): Uint8Array {
  const code = character.codePointAt(0) ?? 0;
  const printable = (code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code < 0x100);
  const index = LATIN_9[character] ?? (printable && !LATIN_9_SLOTS.has(code) ? code : 0x3f);
  const bytes = (GLYPH_WIDTH / 8) * GLYPH_HEIGHT;
  return glyphs.subarray(index * bytes, (index + 1) * bytes);
}

/** A canvas of palette indexes. */
class Canvas {
  readonly pixels = new Uint8Array(CARD_WIDTH * CARD_HEIGHT);

  rect(x: number, y: number, width: number, height: number, color: number): void {
    for (let row = Math.max(0, y); row < Math.min(CARD_HEIGHT, y + height); row++) {
      this.pixels.fill(color, row * CARD_WIDTH + Math.max(0, x), row * CARD_WIDTH + Math.min(CARD_WIDTH, x + width));
    }
  }

  /** A rectangle with its corners rounded to `radius`; a radius larger than half the width or height is held to that half, and a negative one to 0. */
  roundRect(x: number, y: number, width: number, height: number, radius: number, color: number): void {
    const corner = Math.max(0, Math.min(radius, width / 2, height / 2));
    for (let row = 0; row < height; row++) {
      const fromEdge = Math.min(row, height - 1 - row);
      const inset = fromEdge >= corner ? 0 : Math.ceil(corner - Math.sqrt(corner ** 2 - (corner - fromEdge - 0.5) ** 2));
      this.rect(x + inset, y + row, width - 2 * inset, 1, color);
    }
  }

  disc(cx: number, cy: number, radius: number, color: number): void {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) this.rect(x, y, 1, 1, color);
      }
    }
  }

  /** Draw `text` with its left edge at `x`, each glyph pixel `scale` pixels square. */
  text(text: string, x: number, y: number, scale: number, color: number): void {
    let left = x;
    for (const character of text) {
      const glyph = glyphFor(character);
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        const bits = ((glyph[row * 2] ?? 0) << 8) | (glyph[row * 2 + 1] ?? 0);
        for (let column = 0; column < GLYPH_WIDTH; column++) {
          if (bits & (0x8000 >> column)) this.rect(left + column * scale, y + row * scale, scale, scale, color);
        }
      }
      left += GLYPH_WIDTH * scale;
    }
  }
}

/** The text cut to fit `width` pixels at the given scale, ending in "..." when it was cut. */
function fitted(text: string, scale: number, width: number): string {
  const room = Math.floor(width / (GLYPH_WIDTH * scale));
  const characters = [...text];
  return characters.length <= room ? text : `${characters.slice(0, Math.max(0, room - 3)).join("")}...`;
}

/** The largest scale, up to `most`, at which `text` fits the card between its margins; 1 when none does. */
function scaleFor(text: string, most: number): number {
  const width = CARD_WIDTH - 2 * MARGIN;
  for (let scale = most; scale > 1; scale--) if ([...text].length * GLYPH_WIDTH * scale <= width) return scale;
  return 1;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/** A palette PNG of the canvas. */
function encodePng(canvas: Canvas): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(CARD_WIDTH, 0);
  header.writeUInt32BE(CARD_HEIGHT, 4);
  // 8 bits a pixel, palette colour, deflate, no filter method but "none" per row, no interlace.
  header.set([8, 3, 0, 0, 0], 8);
  const rows = Buffer.alloc((CARD_WIDTH + 1) * CARD_HEIGHT);
  for (let row = 0; row < CARD_HEIGHT; row++) rows.set(canvas.pixels.subarray(row * CARD_WIDTH, (row + 1) * CARD_WIDTH), row * (CARD_WIDTH + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", PALETTE),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Draw the link-preview card for a verse share: the title in large letters and the trip under it, on a cassette.
 * Text is drawn from a bitmap font, so a name with characters outside Latin-9 shows "?" for each, and a long one is cut with
 * "...". The card says nothing about money.
 *
 * @param card - `headline` is "An Ode for [name]", `subline` the trip.
 * @returns A 1200 by 630 PNG.
 */
export function renderShareCard({ headline, subline }: { headline: string; subline: string }): Uint8Array {
  const canvas = new Canvas();
  canvas.rect(0, 0, CARD_WIDTH, CARD_HEIGHT, INK);
  canvas.rect(BORDER, BORDER, CARD_WIDTH - 2 * BORDER, CARD_HEIGHT - 2 * BORDER, PAPER);
  canvas.rect(BORDER, BORDER, CARD_WIDTH - 2 * BORDER, BAND_HEIGHT, TAPE);
  canvas.rect(BORDER, BORDER + BAND_HEIGHT, CARD_WIDTH - 2 * BORDER, RULE_HEIGHT, INK);

  const width = CARD_WIDTH - 2 * MARGIN;
  const headlineScale = scaleFor(headline, 4);
  const headlineText = fitted(headline, headlineScale, width);
  const sublineScale = Math.max(1, Math.min(headlineScale - 1, scaleFor(subline, 3)));
  const sublineText = fitted(subline, sublineScale, width);
  const centered = (text: string, scale: number) => Math.floor((CARD_WIDTH - [...text].length * GLYPH_WIDTH * scale) / 2);

  canvas.text(headlineText, centered(headlineText, headlineScale), HEADLINE_TOP, headlineScale, INK);
  canvas.text(sublineText, centered(sublineText, sublineScale), HEADLINE_TOP + GLYPH_HEIGHT * headlineScale + HEADLINE_GAP, sublineScale, INK);

  // The cassette: a dark shell, a label with a tape stripe, and a window with the two reels.
  const shell = (CARD_WIDTH - SHELL_WIDTH) / 2;
  const label = shell + LABEL_INSET;
  const labelWidth = SHELL_WIDTH - 2 * LABEL_INSET;
  canvas.roundRect(shell, SHELL_TOP, SHELL_WIDTH, SHELL_HEIGHT, SHELL_RADIUS, INK);
  canvas.roundRect(label, LABEL_TOP, labelWidth, LABEL_HEIGHT, LABEL_RADIUS, PAPER);
  canvas.rect(label, LABEL_TOP + LABEL_HEIGHT - STRIPE_HEIGHT, labelWidth, STRIPE_HEIGHT, TAPE);
  canvas.rect(label, LABEL_TOP, TAB_WIDTH, STRIPE_HEIGHT, CORAL);
  canvas.roundRect(shell + WINDOW_INSET, WINDOW_TOP, SHELL_WIDTH - 2 * WINDOW_INSET, WINDOW_HEIGHT, WINDOW_HEIGHT / 2, WINDOW);
  for (const cx of [CARD_WIDTH / 2 - REEL_SPACING, CARD_WIDTH / 2 + REEL_SPACING]) {
    canvas.disc(cx, REEL_CENTER_Y, PACK_RADIUS, TAPE_BROWN);
    canvas.disc(cx, REEL_CENTER_Y, HUB_RADIUS, PAPER);
    canvas.disc(cx, REEL_CENTER_Y, SPINDLE_RADIUS, INK);
  }
  return encodePng(canvas);
}
