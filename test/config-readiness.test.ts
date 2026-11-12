import { describe, expect, it } from "vitest";
import { configReadiness } from "../src/server/config-readiness.ts";
import { createHarness } from "./harness.ts";

describe("config readiness", () => {
  it("says no to every setting that is missing or empty", () => {
    expect(configReadiness({ ANTHROPIC_API_KEY: "", PAYPAL_CLIENT_ID: "id" })).toEqual({
      anthropic: false,
      elevenlabs: false,
      paypalClient: false,
      friendAccounts: false,
      paypalWebhookId: false,
    });
  });

  it("says yes to a complete setup", () => {
    expect(
      configReadiness({
        ANTHROPIC_API_KEY: "a",
        ELEVENLABS_API_KEY: "e",
        PAYPAL_CLIENT_ID: "id",
        PAYPAL_CLIENT_SECRET: "secret",
        FRIEND_PAYPAL_ACCOUNTS: "Tharun=t@example.com",
        PAYPAL_WEBHOOK_ID: "6E573194T8199610E",
      }),
    ).toEqual({ anthropic: true, elevenlabs: true, paypalClient: true, friendAccounts: true, paypalWebhookId: true });
  });

  it("does not take a URL, or a quoted id, for the webhook id", () => {
    expect(configReadiness({ PAYPAL_WEBHOOK_ID: "https://ode.example/api/payments/webhook" }).paypalWebhookId).toBe(false);
    expect(configReadiness({ PAYPAL_WEBHOOK_ID: '"6E573194T8199610E"' }).paypalWebhookId).toBe(false);
  });

  it("is shown by the health endpoint when the service was given it, and never carries a value", async () => {
    const config = configReadiness({ PAYPAL_CLIENT_ID: "super-secret-id", PAYPAL_CLIENT_SECRET: "super-secret" });
    const { get } = await createHarness({ config });

    const body = await (await get("/api/health")).json();

    expect(body.config).toEqual(config);
    expect(JSON.stringify(body)).not.toContain("super-secret");
  });
});
