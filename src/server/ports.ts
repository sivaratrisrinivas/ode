import type { ChunkPlan, WordTiming } from "./ode.ts";
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

export interface PayPalOrder {
  orderId: string;
  friendEmail: string;
  amountCents: number;
}

export type PayPalCapture =
  | { status: "COMPLETED"; orderId: string; captureId: string; amountCents: number }
  | { status: "DECLINED"; orderId: string };

export interface PayPal {
  createOrder(request: { friendEmail: string; amountCents: number }): Promise<PayPalOrder>;
  captureOrder(orderId: string): Promise<PayPalCapture>;
  /** The capture response lacks the payee, so it is confirmed by reading the order back. */
  getOrder(orderId: string): Promise<PayPalOrder>;
  verifyWebhook(request: { headers: Record<string, string>; body: string }): Promise<boolean>;
}

export interface Ports {
  clock: Clock;
  claude: Claude;
  music: ElevenMusic;
  paypal: PayPal;
}
