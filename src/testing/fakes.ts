import type { ChunkPlan, WordTiming } from "../server/ode.ts";
import {
  MusicUnavailable,
  type Claude,
  type Clock,
  type ElevenMusic,
  type PayPal,
  type PayPalCapture,
  type PayPalOrder,
  type Ports,
} from "../server/ports.ts";
import { err, ok } from "../server/result.ts";

export interface FakeClock extends Clock {
  set(date: Date): void;
  advance(ms: number): void;
}

export function fakeClock(start = new Date("2026-11-09T00:00:00.000Z")): FakeClock {
  let current = start;
  return {
    now: () => current,
    set: (date) => {
      current = date;
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

/** Canned structured output, keyed by the exact input text. */
export function fakeClaude(canned: Record<string, unknown> = {}): Claude {
  return {
    async structured({ task, input }) {
      if (!Object.hasOwn(canned, input)) {
        throw new Error(`fake Claude has no canned output for ${task} input: ${input}`);
      }
      return ok(canned[input]);
    },
  };
}

/** Canned structured output, keyed by task; each handler sees the request's input text. */
export function fakeClaudeByTask(handlers: Record<string, (input: string) => unknown>): Claude {
  return {
    async structured({ task, input }) {
      const handler = handlers[task];
      if (handler === undefined) throw new Error(`fake Claude has no handler for task ${task}`);
      return ok(handler(input));
    },
  };
}

/** When each line of a verse starts, in ms into its chunk; every line then takes `LINE_SPAN_MS` to sing. */
const LINE_STARTS_MS = [1_000, 4_500, 9_500, 13_000];
const LINE_SPAN_MS = 2_500;

/**
 * How the fake singer treats the lyrics of a verse:
 * - `faithful`: every word as written
 * - `one-word-misheard`: the second word of each line is reported as another word
 * - `wrong-words`: other words entirely, spread over the verse
 * - `scrambled`: the lines in reverse order
 * - `silent`: no words reported at all
 */
export type FakeSinging = "faithful" | "one-word-misheard" | "wrong-words" | "scrambled" | "silent";

/** The words of `text` spread evenly across the song from `startMs` to `endMs`. */
function sing(text: string, startMs: number, endMs: number): WordTiming[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const at = (index: number) => startMs + Math.floor((index * (endMs - startMs)) / words.length);
  return words.map((word, index) => ({ text: word, startMs: at(index), endMs: at(index + 1) }));
}

/** The lines to sing in a chunk: its text without the section tag on the first line. */
function linesOf(chunk: ChunkPlan): string[] {
  return chunk.text.split("\n").slice(1);
}

/** The words a verse chunk starting at `cursor` is reported to contain. */
function singVerse(chunk: ChunkPlan, cursor: number, singing: FakeSinging): WordTiming[] {
  const lines = linesOf(chunk);
  switch (singing) {
    case "silent":
      return [];
    case "wrong-words":
      return sing("la la la la la la la la la la la la la la la la", cursor + 1_000, cursor + chunk.durationMs - 1_000);
    case "scrambled":
      lines.reverse();
      break;
    case "one-word-misheard":
      lines.forEach((line, index) => {
        lines[index] = line
          .split(/\s+/)
          .map((word, position) => (position === 1 ? "mumble" : word))
          .join(" ");
      });
      break;
    case "faithful":
      break;
  }
  return lines.flatMap((line, index) => {
    const start = cursor + (LINE_STARTS_MS[index] ?? 0);
    return sing(line, start, start + LINE_SPAN_MS);
  });
}

export interface FakeMusic extends ElevenMusic {
  /** The next compose call fails with `MusicUnavailable` instead of returning a song. */
  failNextCompose(): void;
}

/**
 * A fake Eleven Music that sings the lyrics it is given, with uneven pauses between the lines of a
 * verse, so that line windows found from the words differ from equal quarters. The audio is 256
 * bytes, 0 to 255, whatever the plan.
 *
 * @param options - `singing` sets how verses are sung: one way for all, or per verse counting from 1.
 */
export function fakeMusic(options: { singing?: FakeSinging | ((verse: number) => FakeSinging) } = {}): FakeMusic {
  const { singing = "faithful" } = options;
  const audio = Uint8Array.from({ length: 256 }, (_, index) => index);
  let failNext = false;

  return {
    failNextCompose() {
      failNext = true;
    },
    async compose(chunks) {
      if (failNext) {
        failNext = false;
        return err(new MusicUnavailable("fake Eleven Music is down"));
      }
      const words: WordTiming[] = [];
      let cursor = 0;
      let verse = 0;
      for (const chunk of chunks) {
        if (chunk.text.startsWith("[Verse")) {
          verse += 1;
          words.push(...singVerse(chunk, cursor, typeof singing === "function" ? singing(verse) : singing));
        } else if (!chunk.text.startsWith("[Intro")) {
          words.push(...sing(linesOf(chunk).join(" "), cursor + 500, cursor + chunk.durationMs - 500));
        }
        cursor += chunk.durationMs;
      }
      return ok({ audio, words });
    },
  };
}

export interface FakePayPal extends PayPal {
  /** The next capture is declined instead of completed. */
  declineNextCapture(): void;
}

export function fakePayPal(): FakePayPal {
  const orders = new Map<string, PayPalOrder>();
  let sequence = 0;
  let decline = false;

  const find = (orderId: string): PayPalOrder => {
    const order = orders.get(orderId);
    if (!order) throw new Error(`fake PayPal has no order ${orderId}`);
    return order;
  };

  return {
    declineNextCapture() {
      decline = true;
    },
    async createOrder({ friendEmail, amountCents }) {
      const order = { orderId: `ORDER-${++sequence}`, friendEmail, amountCents };
      orders.set(order.orderId, order);
      return order;
    },
    async captureOrder(orderId): Promise<PayPalCapture> {
      const order = find(orderId);
      if (decline) {
        decline = false;
        return { status: "DECLINED", orderId };
      }
      return { status: "COMPLETED", orderId, captureId: `CAPTURE-${orderId}`, amountCents: order.amountCents };
    },
    async getOrder(orderId) {
      return find(orderId);
    },
    async verifyWebhook({ headers }) {
      return headers["paypal-transmission-sig"] === "valid";
    },
  };
}

export interface FakePorts extends Ports {
  clock: FakeClock;
  music: FakeMusic;
  paypal: FakePayPal;
}

export function fakePorts(): FakePorts {
  return { clock: fakeClock(), claude: fakeClaude(), music: fakeMusic(), paypal: fakePayPal() };
}
