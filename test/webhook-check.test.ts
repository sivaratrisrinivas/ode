import { describe, expect, it } from "vitest";
import { assessWebhooks, describeReport, parseWebhooks } from "../src/ops/webhook-check.ts";

/** What PayPal's `GET /v1/notifications/webhooks` answers with one webhook, as the docs show it. */
const reply = {
  webhooks: [
    {
      id: "0AB12345CD678901E",
      url: "https://ode-nluc.onrender.com/api/payments/webhook",
      event_types: [{ name: "PAYMENT.CAPTURE.COMPLETED", description: "A payment capture is completed." }],
      links: [],
    },
  ],
};

describe("parseWebhooks", () => {
  it("reads each webhook's id, url and event names", () => {
    expect(parseWebhooks(reply)).toEqual([
      { id: "0AB12345CD678901E", url: "https://ode-nluc.onrender.com/api/payments/webhook", eventNames: ["PAYMENT.CAPTURE.COMPLETED"] },
    ]);
  });

  it("reads nothing from a reply that is not a list of webhooks, and skips an entry without an id or url", () => {
    expect(parseWebhooks(undefined)).toEqual([]);
    expect(parseWebhooks({ webhooks: "none" })).toEqual([]);
    expect(parseWebhooks({ webhooks: [{ url: "https://x.test/api/payments/webhook" }, { id: "A" }, null] })).toEqual([]);
  });
});

describe("assessWebhooks", () => {
  const webhooks = parseWebhooks(reply);

  it("is ready when the configured id is a webhook on the app, at the app's path, with the capture event", () => {
    const report = assessWebhooks(webhooks, "0AB12345CD678901E");
    expect(report.id).toBe("matches");
    expect(report.ready).toBe(true);
    expect(report.webhooks).toEqual([{ id: "0AB12345CD678901E", url: webhooks[0]?.url, urlEndsRight: true, hasCaptureCompleted: true }]);
  });

  it("says so when the configured value is a URL, which is what the main .env held", () => {
    const report = assessWebhooks(webhooks, "https://ode-nluc.onrender.com/api/payments/webhook");
    expect(report.id).toBe("is-a-url");
    expect(report.ready).toBe(false);
    expect(describeReport(report).join("\n")).toMatch(/PAYPAL_WEBHOOK_ID is a URL/);
  });

  it("says so when the id is none of the app's webhooks, or not set", () => {
    expect(assessWebhooks(webhooks, "ZZZZZZZZZZZZZZZZZ").id).toBe("not-on-this-app");
    expect(assessWebhooks(webhooks, undefined).id).toBe("not-set");
  });

  it("is not ready when the matching webhook points at another path or lacks the capture event", () => {
    const wrongPath = parseWebhooks({ webhooks: [{ id: "A1", url: "https://ode-nluc.onrender.com/api/paypal/webhook", event_types: [{ name: "PAYMENT.CAPTURE.COMPLETED" }] }] });
    expect(assessWebhooks(wrongPath, "A1")).toMatchObject({ id: "matches", ready: false, webhooks: [{ urlEndsRight: false, hasCaptureCompleted: true }] });
    const wrongEvent = parseWebhooks({ webhooks: [{ id: "A1", url: "https://x.test/api/payments/webhook", event_types: [{ name: "CHECKOUT.ORDER.APPROVED" }] }] });
    expect(assessWebhooks(wrongEvent, "A1")).toMatchObject({ id: "matches", ready: false, webhooks: [{ urlEndsRight: true, hasCaptureCompleted: false }] });
  });

  it("never repeats the configured value in what it says", () => {
    const secretish = "https://example.test/api/payments/webhook?token=hunter2";
    expect(describeReport(assessWebhooks(webhooks, secretish)).join("\n")).not.toContain("hunter2");
  });

  it("lists no webhooks as a problem", () => {
    expect(describeReport(assessWebhooks([], "A1")).join("\n")).toMatch(/no webhooks/i);
  });
});
