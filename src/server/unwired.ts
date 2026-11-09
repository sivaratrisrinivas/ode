import { ClaudeUnavailable, type Claude, type ElevenMusic, type PayPal } from "./ports.ts";
import { err } from "./result.ts";

function unwired(service: string) {
  return async (): Promise<never> => {
    throw new Error(`${service} adapter is not wired yet`);
  };
}

// Production adapters arrive with the tickets that first need them.
/** Stands in for Claude when no API key is configured: every call reports Claude unavailable. */
export const unwiredClaude: Claude = {
  structured: async () => err(new ClaudeUnavailable("ANTHROPIC_API_KEY is not set")),
};

export const unwiredMusic: ElevenMusic = { compose: unwired("Eleven Music") };

export const unwiredPayPal: PayPal = {
  createOrder: unwired("PayPal"),
  captureOrder: unwired("PayPal"),
  getOrder: unwired("PayPal"),
  verifyWebhook: unwired("PayPal"),
};
