import { field, toCents } from "./paypal.ts";
import type { CapturedPayment } from "./payments.ts";
import { err, ok, type Result } from "./result.ts";

/** The webhook event type that says a payment was captured. */
export const CAPTURE_COMPLETED = "PAYMENT.CAPTURE.COMPLETED";

/** A verified webhook body that is not a capture this service can count. */
export class UnreadableCapture extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "UnreadableCapture" as const;

  constructor() {
    super("The event has no capture ID, order or amount.");
  }
}

/**
 * Read a verified webhook body.
 *
 * @param body - The raw request body, already verified as PayPal's.
 * @returns "other" for any event but a completed capture (or a body that is not JSON), the capture for a completed
 *   one, or `UnreadableCapture` for a completed capture missing its ID, order or amount.
 */
export function parseWebhookEvent(body: string): Result<CapturedPayment | "other", UnreadableCapture> {
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return ok("other");
  }
  if (field(event, "event_type") !== CAPTURE_COMPLETED) return ok("other");

  const resource = field(event, "resource");
  const captureId = field(resource, "id");
  const orderId = field(field(field(resource, "supplementary_data"), "related_ids"), "order_id");
  const amountCents = toCents(field(field(resource, "amount"), "value"));
  if (typeof captureId !== "string" || typeof orderId !== "string" || amountCents === undefined || amountCents < 1) return err(new UnreadableCapture());
  return ok({ captureId, orderId, amountCents });
}
