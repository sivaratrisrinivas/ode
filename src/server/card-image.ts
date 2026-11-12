import { crc32, deflateSync, gunzipSync } from "node:zlib";
import { GLYPH_HEIGHT, GLYPH_WIDTH, TERMINUS_GLYPHS_GZIP_BASE64 } from "./terminus-font.ts";

/** The size chat apps ask of a link-preview image: 1.91 to 1. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** Palette indexes. */
const PAPER = 0;
const INK = 1;
const TAPE = 2;
const TAPE_BROWN = 3;
const WINDOW = 4;
const CORAL = 5;
const PALETTE = Uint8Array.from([0xfa, 0xf7, 0xf0, 0x22, 0x22, 0x22, 0xff, 0xd6, 0x00, 0x5a, 0x3d, 0x24, 0xe8, 0xde, 0xc9, 0xe4, 0x53, 0x3a]);

/** Space kept clear on each side of the text. */
const MARGIN = 80;

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

  /** A rectangle with its corners rounded to `radius`. */
  roundRect(x: number, y: number, width: number, height: number, radius: number, color: number): void {
    for (let row = 0; row < height; row++) {
      const fromEdge = Math.min(row, height - 1 - row);
      const inset = fromEdge >= radius ? 0 : Math.ceil(radius - Math.sqrt(radius ** 2 - (radius - fromEdge - 0.5) ** 2));
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
  canvas.rect(16, 16, CARD_WIDTH - 32, CARD_HEIGHT - 32, PAPER);
  canvas.rect(16, 16, CARD_WIDTH - 32, 56, TAPE);
  canvas.rect(16, 72, CARD_WIDTH - 32, 8, INK);

  const width = CARD_WIDTH - 2 * MARGIN;
  const headlineScale = scaleFor(headline, 4);
  const headlineText = fitted(headline, headlineScale, width);
  const sublineScale = Math.max(1, Math.min(headlineScale - 1, scaleFor(subline, 3)));
  const sublineText = fitted(subline, sublineScale, width);
  const centered = (text: string, scale: number) => Math.floor((CARD_WIDTH - [...text].length * GLYPH_WIDTH * scale) / 2);

  canvas.text(headlineText, centered(headlineText, headlineScale), 150, headlineScale, INK);
  canvas.text(sublineText, centered(sublineText, sublineScale), 150 + GLYPH_HEIGHT * headlineScale + 40, sublineScale, INK);

  // The cassette: a dark shell, a label with a tape stripe, and a window with the two reels.
  const left = (CARD_WIDTH - 520) / 2;
  canvas.roundRect(left, 392, 520, 200, 26, INK);
  canvas.roundRect(left + 24, 408, 472, 58, 10, PAPER);
  canvas.rect(left + 24, 456, 472, 10, TAPE);
  canvas.rect(left + 24, 408, 14, 10, CORAL);
  canvas.roundRect(left + 40, 482, 440, 84, 42, WINDOW);
  for (const cx of [CARD_WIDTH / 2 - 100, CARD_WIDTH / 2 + 100]) {
    canvas.disc(cx, 524, 38, TAPE_BROWN);
    canvas.disc(cx, 524, 22, PAPER);
    canvas.disc(cx, 524, 8, INK);
  }
  return encodePng(canvas);
}
