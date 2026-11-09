import type {
  Claude,
  Clock,
  ComposedChunk,
  ElevenMusic,
  PayPal,
  PayPalCapture,
  PayPalOrder,
  Ports,
} from "../server/ports.ts";

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
      return canned[input];
    },
  };
}

export function fakeMusic(chunk: ComposedChunk = { audio: new Uint8Array(), words: [] }): ElevenMusic {
  return { compose: async () => chunk };
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
  paypal: FakePayPal;
}

export function fakePorts(): FakePorts {
  return { clock: fakeClock(), claude: fakeClaude(), music: fakeMusic(), paypal: fakePayPal() };
}
