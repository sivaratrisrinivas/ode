import type { ChunkPlan, WordTiming } from "./ode.ts";
import type { RunId, WorkflowRunId } from "./ode-run.ts";
import type { Result } from "./result.ts";

/** Runs queries; the same shape for a pool, a transaction and PGlite. */
export interface Queryable {
  query<Row extends object>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

/** Postgres. A transaction commits when `work` resolves and rolls back when it rejects. */
export interface Sql extends Queryable {
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

/** A JSON Schema object, as the structured-output API takes it. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** Claude could not produce an answer: network, quota, refusal or a cut-off reply. */
export class ClaudeUnavailable extends Error {
  readonly _tag = "ClaudeUnavailable" as const;

  constructor(cause: unknown) {
    super("Claude is unavailable", { cause });
  }
}

/**
 * Claude: structured output for a task (ledger extraction, lyric writing).
 * The reply follows `schema` but is still `unknown`: callers parse it before use.
 */
export interface Claude {
  structured(request: {
    task: string;
    instructions: string;
    schema: JsonSchema;
    input: string;
  }): Promise<Result<unknown, ClaudeUnavailable>>;
}

/** The finished song: one audio file and when every sung word lands in it. */
export interface ComposedSong {
  audio: Uint8Array;
  /** In song order, with times counted from the start of the whole song, not of a chunk. */
  words: WordTiming[];
}

/** Eleven Music could not compose the song: network, quota, a rejected plan or an unreadable reply. */
export class MusicUnavailable extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "MusicUnavailable" as const;

  /** @param cause - What went wrong: a network error, an HTTP error reply or a parse problem. */
  constructor(cause: unknown) {
    super("Eleven Music is unavailable", { cause });
  }
}

/**
 * Eleven Music: the whole song in one call, as consecutive chunks (one per verse, ADR 0001).
 * The song's chunks run back to back, each for its planned duration.
 */
export interface ElevenMusic {
  compose(chunks: readonly ChunkPlan[]): Promise<Result<ComposedSong, MusicUnavailable>>;
}

/** The Workflow could not be reached or did not answer as expected: network, credentials, an unknown task or an unreadable reply. */
export class WorkflowUnavailable extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "WorkflowUnavailable" as const;

  /** @param cause - What went wrong: a network error, an API error reply or a status this service does not know. */
  constructor(cause: unknown) {
    super("The Workflow is unavailable", { cause });
  }
}

/** Where the Workflow says a run is: still going, or ended in the way named. */
export type WorkflowRunState = "active" | "completed" | "failed" | "canceled";

/**
 * The Workflow that runs the song pipeline as one task (lyrics, compose, line windows, store) away from the web service.
 * The task tells the payer how far it got through the database, not through this port: this port only starts a run
 * and says whether it is still going, so a run that died can be told from one that is slow.
 */
export interface OdeWorkflow {
  /**
   * Start the task for `run`. Starting the same run again does not start a second task.
   *
   * @returns The Workflow's record of the run, or why it could not be started.
   */
  start(run: RunId): Promise<Result<WorkflowRunId, WorkflowUnavailable>>;
  /**
   * Ask the Workflow how a run it started is doing.
   *
   * @returns Where the run is, or why the Workflow could not say.
   */
  status(run: WorkflowRunId): Promise<Result<WorkflowRunState, WorkflowUnavailable>>;
}

/** PayPal could not answer: network, credentials, an order it does not know or a reply this service cannot read. */
export class PayPalUnavailable extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "PayPalUnavailable" as const;

  /** @param cause - What went wrong: a network error, an API error reply or a parse problem. */
  constructor(cause: unknown) {
    super("PayPal is unavailable", { cause });
  }
}

/** A PayPal order: the amount the payer is asked to approve, and the sandbox account it pays. */
export interface PayPalOrder {
  orderId: string;
  /** The payee, as PayPal reads it back. */
  friendEmail: string;
  amountCents: number;
}

/** How capturing an order ended. `amountCents` is gross, before PayPal's fee. */
export type PayPalCapture =
  | { status: "COMPLETED"; orderId: string; captureId: string; amountCents: number }
  | { status: "DECLINED"; orderId: string };

/** PayPal Orders v2: one order per payment, paid to a different payee each time. */
export interface PayPal {
  /** Create an order paying `friendEmail` `amountCents` once the payer approves it. */
  createOrder(request: { friendEmail: string; amountCents: number }): Promise<Result<PayPalOrder, PayPalUnavailable>>;
  /** Take the money for an order the payer approved. A declined payment is a value, not an error. */
  captureOrder(orderId: string): Promise<Result<PayPalCapture, PayPalUnavailable>>;
  /** The capture response lacks the payee, so it is confirmed by reading the order back. */
  getOrder(orderId: string): Promise<Result<PayPalOrder, PayPalUnavailable>>;
  verifyWebhook(request: { headers: Record<string, string>; body: string }): Promise<boolean>;
}

export interface Ports {
  clock: Clock;
  claude: Claude;
  music: ElevenMusic;
  paypal: PayPal;
}
