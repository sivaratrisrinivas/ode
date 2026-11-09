import type { Claude, ElevenMusic, PayPal } from "./ports.ts";

function unwired(service: string) {
  return async (): Promise<never> => {
    throw new Error(`${service} adapter is not wired yet`);
  };
}

// Production adapters arrive with the tickets that first need them.
export const unwiredClaude: Claude = { structured: unwired("Claude") };

export const unwiredMusic: ElevenMusic = { compose: unwired("Eleven Music") };

export const unwiredPayPal: PayPal = {
  createOrder: unwired("PayPal"),
  captureOrder: unwired("PayPal"),
  getOrder: unwired("PayPal"),
  verifyWebhook: unwired("PayPal"),
};
