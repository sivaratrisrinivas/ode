import { createInProcessWorkflow } from "../server/in-process-workflow.ts";
import type { ChunkPlan, WordTiming } from "../server/ode.ts";
import type { OdeJob } from "../server/ode-job.ts";
import type { OdeRunOutcome } from "../server/ode-pipeline.ts";
import { parseWorkflowRunId, type RunId, type WorkflowRunId } from "../server/ode-run.ts";
import {
  MusicUnavailable,
  WorkflowUnavailable,
  type Claude,
  type Clock,
  type ElevenMusic,
  type OdeWorkflow,
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

/** A fake Render Workflow, with a switch for each way a real one lets a run down. */
export interface FakeWorkflow extends OdeWorkflow {
  /** The next run's instance is lost: it never does anything, and the Workflow reports the run failed. */
  loseNextRun(): void;
  /** The next start is refused with `WorkflowUnavailable`. */
  refuseNextStart(): void;
  /** The next start never answers, as when the web service dies mid-request. */
  hangNextStart(): void;
  /**
   * The next run's instance takes a while to start: the Workflow accepts the run and reports it active,
   * but the task does nothing until the returned function is called.
   */
  holdNextRun(): () => void;
  /** From now on the Workflow reports every run it has already started as failed, though their instances carry on. */
  reportStartedRunsFailed(): void;
  /** From now on every question about a run is refused with `WorkflowUnavailable`, as with a revoked API key. */
  refuseStatusChecks(): void;
  /**
   * Wait until `count` task runs have ended.
   *
   * @returns How each run ended, in the order they ended: what the Workflow's dashboard shows as the task's result.
   */
  whenRunsEnd(count: number): Promise<OdeRunOutcome[]>;
}

/**
 * A fake Render Workflow: it runs the same job the Render task runs, in this process, apart from
 * the web service's own stores. A run it loses, refuses or hangs on does nothing at all.
 *
 * @param job - Makes the Ode for a run.
 */
export function fakeWorkflow(job: OdeJob): FakeWorkflow {
  const ended: OdeRunOutcome[] = [];
  const watchers: { count: number; resolve: (outcomes: OdeRunOutcome[]) => void }[] = [];
  const gates = new Map<RunId, Promise<void>>();
  const inner = createInProcessWorkflow(async (run) => {
    await gates.get(run);
    const outcome = await job(run);
    ended.push(outcome);
    for (const watcher of watchers.filter((w) => w.count <= ended.length)) watcher.resolve([...ended]);
    return outcome;
  });
  const started = new Set<WorkflowRunId>();
  const failed = new Set<WorkflowRunId>();
  let next: "run" | "lose" | "refuse" | "hang" | "hold" = "run";
  let release = () => {};
  let refuseStatus = false;

  /** The Workflow's record of `run`, as `inner` names it, remembered so the Workflow can be told what to report. */
  async function startInner(run: RunId) {
    const id = await inner.start(run);
    if (id._tag === "ok") started.add(id.value);
    return id;
  }

  return {
    loseNextRun() {
      next = "lose";
    },
    refuseNextStart() {
      next = "refuse";
    },
    hangNextStart() {
      next = "hang";
    },
    holdNextRun() {
      next = "hold";
      return () => release();
    },
    reportStartedRunsFailed() {
      for (const id of started) failed.add(id);
    },
    refuseStatusChecks() {
      refuseStatus = true;
    },
    whenRunsEnd(count) {
      if (ended.length >= count) return Promise.resolve([...ended]);
      return new Promise((resolve) => watchers.push({ count, resolve }));
    },
    async start(run) {
      const behaviour = next;
      next = "run";
      switch (behaviour) {
        case "refuse":
          return err(new WorkflowUnavailable("fake Workflow is down"));
        case "hang":
          return new Promise(() => {});
        case "lose": {
          const id = parseWorkflowRunId(`lost-${run}`);
          if (id._tag === "err") return err(new WorkflowUnavailable(id.error));
          failed.add(id.value);
          return ok(id.value);
        }
        case "hold":
          gates.set(
            run,
            new Promise<void>((resolve) => {
              release = resolve;
            }),
          );
          return startInner(run);
        case "run":
          return startInner(run);
      }
    },
    async status(run) {
      if (refuseStatus) return err(new WorkflowUnavailable("fake Workflow refuses status checks"));
      return failed.has(run) ? ok("failed") : inner.status(run);
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
