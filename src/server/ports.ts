/** Postgres, as both `pg` and PGlite expose it. */
export interface Sql {
  query<Row extends object>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface Clock {
  now(): Date;
}

/** Claude: structured output for a task (ledger extraction, lyric writing). */
export interface Claude {
  structured(request: { task: string; input: string }): Promise<unknown>;
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
