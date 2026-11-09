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

export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
}

export interface ComposedChunk {
  audio: Uint8Array;
  words: WordTiming[];
}

/** Eleven Music: one chunk per verse (ADR 0001). */
export interface ElevenMusic {
  compose(request: { lyrics: string; styles: string[]; durationMs: number }): Promise<ComposedChunk>;
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
