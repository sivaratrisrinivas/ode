import { describe, expect, it } from "vitest";
import { friendAccounts, parseFriendAccounts } from "../src/server/friend-accounts.ts";
import { createPayPal } from "../src/server/paypal.ts";

// The production adapter sits behind the PayPal port, so the API tests never reach it. These tests give it a fake
// `fetch` (no network, no keys) shaped like the Orders v2 replies recorded in notes/day1-checks.md.

interface Call {
  method: string;
  url: string;
  body: string | undefined;
}

/** A `fetch` that answers each request from `answers` by method and path suffix, and remembers the requests. */
function paypalFetch(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const send: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "TOKEN", expires_in: 32_400 });
    const key = Object.keys(answers).find((candidate) => `${method} ${url}`.endsWith(candidate));
    if (key === undefined) throw new Error(`unexpected request ${method} ${url}`);
    const answer = answers[key];
    return Response.json(answer?.body, { status: answer?.status ?? 200 });
  };
  return { send, calls };
}

const adapter = (send: typeof fetch) => createPayPal({ clientId: "id", clientSecret: "secret", env: "sandbox", fetch: send });

const capturedReply = {
  status: "COMPLETED",
  purchase_units: [{ payments: { captures: [{ id: "CAP-1", status: "COMPLETED", amount: { currency_code: "USD", value: "50.00" } }] } }],
};

describe("the PayPal adapter", () => {
  it("creates an order that pays the friend's account the amount in dollars", async () => {
    const { send, calls } = paypalFetch({ "POST https://api-m.sandbox.paypal.com/v2/checkout/orders": { body: { id: "ORD-1" } } });

    const order = await adapter(send).createOrder({ friendEmail: "tharun@example.com", amountCents: 5_000 });

    expect(order).toEqual({ _tag: "ok", value: { orderId: "ORD-1", friendEmail: "tharun@example.com", amountCents: 5_000 } });
    expect(JSON.parse(calls.at(-1)?.body ?? "")).toEqual({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: "50.00" }, payee: { email_address: "tharun@example.com" } }],
    });
  });

  it("reads the payee and amount back from the order", async () => {
    const { send } = paypalFetch({
      "GET https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD-1": {
        body: { purchase_units: [{ amount: { value: "50.00" }, payee: { email_address: "tharun@example.com" } }] },
      },
    });

    expect(await adapter(send).getOrder("ORD-1")).toEqual({ _tag: "ok", value: { orderId: "ORD-1", friendEmail: "tharun@example.com", amountCents: 5_000 } });
  });

  it("reports a completed capture with its ID and gross amount", async () => {
    const { send } = paypalFetch({ "POST https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD-1/capture": { body: capturedReply } });

    expect(await adapter(send).captureOrder("ORD-1")).toEqual({ _tag: "ok", value: { status: "COMPLETED", orderId: "ORD-1", captureId: "CAP-1", amountCents: 5_000 } });
  });

  it("reports a declined payment as declined, not as an outage", async () => {
    const { send } = paypalFetch({ "POST https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD-1/capture": { status: 422, body: { name: "INSTRUMENT_DECLINED" } } });

    expect(await adapter(send).captureOrder("ORD-1")).toEqual({ _tag: "ok", value: { status: "DECLINED", orderId: "ORD-1" } });
  });

  it("reports any other refusal as PayPal being unavailable", async () => {
    const { send } = paypalFetch({ "POST https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD-1/capture": { status: 404, body: { name: "RESOURCE_NOT_FOUND" } } });

    expect(await adapter(send).captureOrder("ORD-1")).toMatchObject({ _tag: "err", error: { _tag: "PayPalUnavailable" } });
  });

  it("reports a capture that is not completed as declined", async () => {
    const { send } = paypalFetch({
      "POST https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD-1/capture": {
        body: { status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP-1", status: "PENDING", amount: { value: "50.00" } }] } }] },
      },
    });

    expect(await adapter(send).captureOrder("ORD-1")).toMatchObject({ _tag: "ok", value: { status: "DECLINED" } });
  });

  it("answers a second capture of the same order with the first capture's ID", async () => {
    const { send } = paypalFetch({
      "POST https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD-1/capture": { status: 422, body: { name: "ORDER_ALREADY_CAPTURED" } },
      "GET https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD-1": { body: capturedReply },
    });

    expect(await adapter(send).captureOrder("ORD-1")).toEqual({ _tag: "ok", value: { status: "COMPLETED", orderId: "ORD-1", captureId: "CAP-1", amountCents: 5_000 } });
  });

  it("asks for one access token and reuses it", async () => {
    const { send, calls } = paypalFetch({
      "GET https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD-1": { body: { purchase_units: [{ amount: { value: "1.00" }, payee: { email_address: "a@b.c" } }] } },
    });
    const paypal = adapter(send);

    await paypal.getOrder("ORD-1");
    await paypal.getOrder("ORD-1");

    expect(calls.filter((call) => call.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
  });

  it("is unavailable when the network fails or PayPal's reply cannot be read", async () => {
    const down: typeof fetch = async () => {
      throw new Error("offline");
    };
    const unreadable = paypalFetch({ "GET https://api-m.sandbox.paypal.com/v2/checkout/orders/ORD-1": { body: { purchase_units: [] } } });

    expect(await adapter(down).getOrder("ORD-1")).toMatchObject({ _tag: "err", error: { _tag: "PayPalUnavailable" } });
    expect(await adapter(unreadable.send).getOrder("ORD-1")).toMatchObject({ _tag: "err", error: { _tag: "PayPalUnavailable" } });
  });
});

describe("friend accounts", () => {
  it("finds a friend's account and an account's friend whatever the letter case", () => {
    const accounts = friendAccounts({ Tharun: "Tharun@Example.com" });

    expect(accounts.emailFor("tharun")).toBe("Tharun@Example.com");
    expect(accounts.friendFor("tharun@example.COM")).toBe("Tharun");
    expect(accounts.emailFor("Vikram")).toBeUndefined();
  });

  it("reads Name=email pairs from the setting", () => {
    const parsed = parseFriendAccounts(" Tharun=t@example.com , Vikram=v@example.com ");

    expect(parsed._tag === "ok" && parsed.value.emailFor("Vikram")).toBe("v@example.com");
  });

  it.each([undefined, ""])("reads %j as no accounts", (setting) => {
    const parsed = parseFriendAccounts(setting);

    expect(parsed._tag === "ok" && parsed.value.emailFor("Tharun")).toBeUndefined();
  });

  it.each(["Tharun", "Tharun=", "=t@example.com", "Tharun=a=b"])("rejects the entry %j", (entry) => {
    expect(parseFriendAccounts(`Vikram=v@example.com,${entry}`)).toMatchObject({ _tag: "err", error: { _tag: "InvalidFriendAccounts" } });
  });
});
