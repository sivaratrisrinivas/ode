import { PayPalUnavailable, type PayPal, type PayPalCapture, type PayPalOrder } from "./ports.ts";
import { err, ok, type Result } from "./result.ts";

const HOSTS = { sandbox: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" } as const;
/** A PayPal call takes a second or two; this only stops a hung request from holding the payer's page. */
const TIMEOUT_MS = 30_000;

/** The headers PayPal signs a webhook with, in the order PayPal's verification call takes them: algorithm, certificate, ID, signature, time. */
const SIGNATURE_HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"] as const;

/** The named property of an object reply; undefined when `value` is not an object or lacks it. */
export function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

/** "50.00" to 5000; undefined when it is not an amount. */
export function toCents(value: unknown): number | undefined {
  const cents = typeof value === "string" ? Math.round(Number(value) * 100) : NaN;
  return Number.isInteger(cents) ? cents : undefined;
}

/** The first purchase unit of an order reply; undefined when there is none. */
function firstUnit(reply: unknown): unknown {
  const units = field(reply, "purchase_units");
  return Array.isArray(units) ? units[0] : undefined;
}

/** What PayPal's reply says an order is: its payee and amount, read from the first purchase unit. */
function parseOrder(orderId: string, reply: unknown): Result<PayPalOrder, PayPalUnavailable> {
  const unit = firstUnit(reply);
  const friendEmail = field(field(unit, "payee"), "email_address");
  const amountCents = toCents(field(field(unit, "amount"), "value"));
  if (typeof friendEmail !== "string" || amountCents === undefined) return err(new PayPalUnavailable(new Error("the order had no payee or amount")));
  return ok({ orderId, friendEmail, amountCents });
}

/** The first capture in an order reply; undefined when there is none or it has no ID or amount. */
function firstCapture(reply: unknown): { captureId: string; status: unknown; amountCents: number } | undefined {
  const captures = field(field(firstUnit(reply), "payments"), "captures");
  const capture: unknown = Array.isArray(captures) ? captures[0] : undefined;
  const captureId = field(capture, "id");
  const amountCents = toCents(field(field(capture, "amount"), "value"));
  if (typeof captureId !== "string" || amountCents === undefined) return undefined;
  return { captureId, status: field(capture, "status"), amountCents };
}

/**
 * The production PayPal port over Orders v2: create an order with a payee per friend, capture it, and read it back
 * (the capture reply has no payee, `notes/day1-checks.md`). It gets an access token with the client credentials and
 * keeps it until shortly before it expires. A webhook is trusted only when PayPal itself verifies its signature
 * against `webhookId`; with no `webhookId`, none is.
 *
 * @param options - The app's sandbox (or live) credentials and the webhook's ID; `fetch` is replaceable for tests.
 */
export function createPayPal(options: { clientId: string; clientSecret: string; env: "sandbox" | "live"; webhookId?: string; fetch?: typeof fetch }): PayPal {
  const send = options.fetch ?? fetch;
  const host = HOSTS[options.env];
  let token: { value: string; expiresAt: number } | undefined;

  /** Throws when PayPal refuses the credentials or answers unreadably; every port method below catches it and reports `PayPalUnavailable`. */
  async function accessToken(): Promise<string> {
    if (token !== undefined && token.expiresAt > Date.now()) return token.value;
    const response = await send(`${host}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`PayPal token request: HTTP ${response.status}`);
    const reply: unknown = await response.json();
    const value = field(reply, "access_token");
    const expiresIn = field(reply, "expires_in");
    if (typeof value !== "string" || typeof expiresIn !== "number") throw new Error("PayPal token reply was unreadable");
    // Renewed a minute early so a token never expires between being read and being used.
    token = { value, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
    return value;
  }

  /** Call PayPal; the reply's status and JSON body are returned whatever the status, for callers that read a refusal. */
  async function request(method: "GET" | "POST", url: string, body?: unknown): Promise<{ status: number; reply: unknown }> {
    const response = await send(url, {
      method,
      headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, reply: await response.json().catch(() => undefined) };
  }

  const call = (method: "GET" | "POST", path: string, body?: unknown) => request(method, `${host}/v2/checkout/orders${path}`, body);

  const failed = (what: string, status: number, reply: unknown) =>
    err(new PayPalUnavailable(new Error(`${what}: HTTP ${status} ${JSON.stringify(reply)?.slice(0, 300)}`)));

  return {
    async createOrder({ friendEmail, amountCents }) {
      try {
        const { status, reply } = await call("POST", "", {
          intent: "CAPTURE",
          purchase_units: [{ amount: { currency_code: "USD", value: (amountCents / 100).toFixed(2) }, payee: { email_address: friendEmail } }],
        });
        const orderId = field(reply, "id");
        if (status >= 300 || typeof orderId !== "string") return failed("create order", status, reply);
        return ok({ orderId, friendEmail, amountCents });
      } catch (cause) {
        return err(new PayPalUnavailable(cause));
      }
    },

    async captureOrder(orderId) {
      try {
        const { status, reply } = await call("POST", `/${encodeURIComponent(orderId)}/capture`);
        const name = field(reply, "name");
        if (name === "INSTRUMENT_DECLINED") return ok({ status: "DECLINED", orderId });
        if (name === "ORDER_ALREADY_CAPTURED") {
          // The same order captured again is the same capture: read it back so it is counted once, under its own ID.
          const read = await call("GET", `/${encodeURIComponent(orderId)}`);
          const capture = firstCapture(read.reply);
          return capture?.status === "COMPLETED" ? ok({ status: "COMPLETED", orderId, captureId: capture.captureId, amountCents: capture.amountCents }) : failed("capture order", read.status, read.reply);
        }
        if (status >= 300) return failed("capture order", status, reply);

        const capture = firstCapture(reply);
        if (capture === undefined) return failed("capture order", status, reply);
        // Anything but a completed capture (declined, pending, a refused funding source) moved no money the payer can rely on.
        const result: PayPalCapture =
          field(reply, "status") === "COMPLETED" && capture.status === "COMPLETED"
            ? { status: "COMPLETED", orderId, captureId: capture.captureId, amountCents: capture.amountCents }
            : { status: "DECLINED", orderId };
        return ok(result);
      } catch (cause) {
        return err(new PayPalUnavailable(cause));
      }
    },

    async getOrder(orderId) {
      try {
        const { status, reply } = await call("GET", `/${encodeURIComponent(orderId)}`);
        return status >= 300 ? failed("read order", status, reply) : parseOrder(orderId, reply);
      } catch (cause) {
        return err(new PayPalUnavailable(cause));
      }
    },

    async verifyWebhook({ headers, body }) {
      // Anything short of PayPal saying the signature is good (no webhook ID, a missing header, a body that is not
      // JSON, PayPal unreachable) is a webhook that is not trusted.
      if (options.webhookId === undefined) return false;
      const [algo, certUrl, id, signature, time] = SIGNATURE_HEADERS.map((name) => headers[name]);
      if (algo === undefined || certUrl === undefined || id === undefined || signature === undefined || time === undefined) return false;
      try {
        const { reply } = await request("POST", `${host}/v1/notifications/verify-webhook-signature`, {
          auth_algo: algo,
          cert_url: certUrl,
          transmission_id: id,
          transmission_sig: signature,
          transmission_time: time,
          webhook_id: options.webhookId,
          webhook_event: JSON.parse(body),
        });
        return field(reply, "verification_status") === "SUCCESS";
      } catch {
        return false;
      }
    },
  };
}
