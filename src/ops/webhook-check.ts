import { field } from "../server/paypal.ts";

/** Where the app takes PayPal's webhook, and the event it unlocks lines from. */
export const WEBHOOK_PATH = "/api/payments/webhook";
export const CAPTURE_EVENT = "PAYMENT.CAPTURE.COMPLETED";

/** A webhook registered on the PayPal app: its id, the URL PayPal posts to, and the event types it is subscribed to. */
export interface WebhookInfo {
  id: string;
  url: string;
  eventNames: string[];
}

/** The name of an event type entry, as a list of one; empty when it has none. */
function eventName(type: unknown): string[] {
  const name = field(type, "name");
  return typeof name === "string" ? [name] : [];
}

/**
 * Read the webhooks out of PayPal's `GET /v1/notifications/webhooks` reply.
 *
 * @returns Each webhook that has an id and a url; an empty list when the reply is not a list of webhooks (nothing throws).
 */
export function parseWebhooks(reply: unknown): WebhookInfo[] {
  const list = field(reply, "webhooks");
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: unknown) => {
    const id = field(entry, "id");
    const url = field(entry, "url");
    if (typeof id !== "string" || typeof url !== "string") return [];
    const types = field(entry, "event_types");
    const eventNames = Array.isArray(types) ? types.flatMap((type: unknown) => eventName(type)) : [];
    return [{ id, url, eventNames }];
  });
}

/** What the configured `PAYPAL_WEBHOOK_ID` is: a webhook of this app, a URL (a common mix-up), some other value, or unset. */
export type IdVerdict = "matches" | "is-a-url" | "not-on-this-app" | "not-set";

/** How one webhook measures against what the app needs. */
export interface WebhookVerdict {
  id: string;
  url: string;
  urlEndsRight: boolean;
  hasCaptureCompleted: boolean;
}

/** The verdict on the configuration; `ready` when the configured id is a webhook that posts to the app's path and has the capture event. */
export interface Report {
  id: IdVerdict;
  webhooks: WebhookVerdict[];
  ready: boolean;
}

/**
 * Judge the sandbox app's webhooks against the app's needs and the configured id.
 *
 * @param webhooks - What `parseWebhooks` read.
 * @param configuredId - The value of `PAYPAL_WEBHOOK_ID`, undefined or empty when unset. It is only compared, never kept in the report.
 */
export function assessWebhooks(webhooks: readonly WebhookInfo[], configuredId: string | undefined): Report {
  const verdicts = webhooks.map((webhook) => ({
    id: webhook.id,
    url: webhook.url,
    urlEndsRight: webhook.url.endsWith(WEBHOOK_PATH),
    hasCaptureCompleted: webhook.eventNames.includes(CAPTURE_EVENT),
  }));
  const chosen = verdicts.find((verdict) => verdict.id === configuredId);
  const id: IdVerdict = configuredId === undefined || configuredId === "" ? "not-set" : chosen !== undefined ? "matches" : /^https?:\/\//i.test(configuredId) ? "is-a-url" : "not-on-this-app";
  return { id, webhooks: verdicts, ready: chosen !== undefined && chosen.urlEndsRight && chosen.hasCaptureCompleted };
}

/** The report as lines to print: one per webhook, then one for the configured id and the verdict. Prints no secret and not the configured value. */
export function describeReport(report: Report): string[] {
  const lines =
    report.webhooks.length === 0
      ? [`The sandbox app has no webhooks: add one that posts ${CAPTURE_EVENT} to <the app's URL>${WEBHOOK_PATH}.`]
      : report.webhooks.map((webhook) => `webhook ${webhook.id}: ${webhook.url} (path ${webhook.urlEndsRight ? "ok" : `NOT ${WEBHOOK_PATH}`}, ${CAPTURE_EVENT} ${webhook.hasCaptureCompleted ? "subscribed" : "NOT subscribed"})`);
  const about: Record<IdVerdict, string> = {
    matches: "PAYPAL_WEBHOOK_ID is the id of one of those webhooks.",
    "is-a-url": "PAYPAL_WEBHOOK_ID is a URL, not a webhook id: set it to the id of the webhook above (this script does not edit .env). The app rejects every real webhook until it is.",
    "not-on-this-app": "PAYPAL_WEBHOOK_ID is not the id of any webhook on this sandbox app: set it to one of the ids above (this script does not edit .env).",
    "not-set": "PAYPAL_WEBHOOK_ID is not set: set it to the id of the webhook above.",
  };
  return [...lines, about[report.id], report.ready ? "Ready: PayPal's capture webhook can be verified and reach the app." : "Not ready."];
}
