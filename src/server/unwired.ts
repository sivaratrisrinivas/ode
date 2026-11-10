import { ClaudeUnavailable, MusicUnavailable, PayPalUnavailable, type Claude, type ElevenMusic, type PayPal } from "./ports.ts";
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

/** Stands in for Eleven Music when no API key is configured: every call reports it unavailable. */
export const unwiredMusic: ElevenMusic = {
  compose: async () => err(new MusicUnavailable("ELEVENLABS_API_KEY is not set")),
};

const PAYPAL_NOT_SET = "PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set";

/** Stands in for PayPal when no credentials are configured: every order call reports it unavailable. */
export const unwiredPayPal: PayPal = {
  createOrder: async () => err(new PayPalUnavailable(PAYPAL_NOT_SET)),
  captureOrder: async () => err(new PayPalUnavailable(PAYPAL_NOT_SET)),
  getOrder: async () => err(new PayPalUnavailable(PAYPAL_NOT_SET)),
  verifyWebhook: unwired("PayPal"),
};
