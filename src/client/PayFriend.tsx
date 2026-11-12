import { useEffect, useRef, useState, type ReactElement } from "react";
import { failureMessage, UNREACHABLE } from "./messages.tsx";
import { Meter } from "./chrome.tsx";
import { loadPayPalSdk } from "./paypal-sdk.ts";

/** Where one friend stands, as the API tells the page. */
export interface Payment {
  amountOwedCents: number;
  amountRepaidCents: number;
  linesUnlocked: number;
  nextLineAtCents: number | null;
  canPay: boolean;
}

/** The PayPal app's client ID; null when none is configured, so the page offers its keyless Pay button; undefined while loading. */
export type ClientId = string | null | undefined;

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Whole cents from what the payer typed ("50", "47.5"); undefined when it is not an amount. */
function parseDollars(text: string): number | undefined {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) return undefined;
  const cents = Math.round(Number(text) * 100);
  return cents >= 1 ? cents : undefined;
}

const DID_NOT_GO_THROUGH = "Your payment didn't go through. Nothing was sent.";
const NEEDS_AMOUNT = "Enter an amount like 50 or 47.50.";

/** Create the order for `friend`; the reply's `orderId`, or the message to show the payer. */
async function createOrder(friend: string, amountCents: number): Promise<{ orderId: string } | { problem: string }> {
  const res = await fetch("/api/payments/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ friend, amountCents }),
  });
  if (!res.ok) return { problem: await failureMessage(res) };
  const body: { orderId: string } = await res.json();
  return { orderId: body.orderId };
}

/** Capture an approved order; null when it was captured, or the message to show the payer. */
async function captureOrder(orderId: string): Promise<string | null> {
  const res = await fetch("/api/payments/capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  return res.ok ? null : failureMessage(res);
}

/**
 * Pay one friend any amount up to what is still owed: PayPal's popup when the app has a client ID, a plain button
 * otherwise. The server decides what is allowed and what unlocks; this shows its answer.
 *
 * @param props - The friend, where they stand, the client ID, and what to do once a payment has been captured.
 */
export function PayFriend({ friend, payment, clientId, onPaid }: { friend: string; payment: Payment; clientId: ClientId; onPaid: () => void }): ReactElement {
  const [amount, setAmount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  // PayPal's buttons are made once and call back later, so they read the amount from here.
  const amountText = useRef(amount);
  amountText.current = amount;
  const paid = useRef(onPaid);
  paid.current = onPaid;
  const container = useRef<HTMLDivElement>(null);

  const usesPayPal = typeof clientId === "string" && payment.canPay;
  useEffect(() => {
    if (!usesPayPal) return;
    let closed = false;
    let buttons: { close(): Promise<void> } | undefined;
    loadPayPalSdk(clientId)
      .then(async (sdk) => {
        const made = sdk.Buttons({
          onClick: async (_data, actions) => {
            if (parseDollars(amountText.current) === undefined) {
              setProblem(NEEDS_AMOUNT);
              return actions.reject();
            }
            setProblem(null);
            return actions.resolve();
          },
          createOrder: async () => {
            const cents = parseDollars(amountText.current);
            if (cents === undefined) throw new Error(NEEDS_AMOUNT);
            const order = await createOrder(friend, cents);
            if ("problem" in order) {
              setProblem(order.problem);
              throw new Error(order.problem);
            }
            return order.orderId;
          },
          onApprove: async ({ orderID }) => {
            const failed = await captureOrder(orderID);
            if (failed !== null) return setProblem(failed);
            setAmount("");
            paid.current();
          },
          onCancel: () => setProblem(DID_NOT_GO_THROUGH),
          onError: () => setProblem((current) => current ?? DID_NOT_GO_THROUGH),
        });
        buttons = made;
        if (!closed && container.current !== null) await made.render(container.current);
      })
      .catch(() => setProblem("Couldn’t load PayPal. Check your connection and reload."));
    return () => {
      closed = true;
      void buttons?.close();
    };
  }, [usesPayPal, clientId, friend]);

  async function payWithoutPayPal() {
    const cents = parseDollars(amount);
    if (cents === undefined) return setProblem(NEEDS_AMOUNT);
    setPaying(true);
    setProblem(null);
    try {
      const order = await createOrder(friend, cents);
      if ("problem" in order) return setProblem(order.problem);
      const failed = await captureOrder(order.orderId);
      if (failed !== null) return setProblem(failed);
      setAmount("");
      onPaid();
    } catch {
      setProblem(UNREACHABLE);
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="ode-pay">
      <p className="ode-pay-line">
        {dollars(payment.amountRepaidCents)} of {dollars(payment.amountOwedCents)} back
        {payment.nextLineAtCents !== null && <> · next line at {dollars(payment.nextLineAtCents)}</>}
      </p>
      <Meter repaidCents={payment.amountRepaidCents} owedCents={payment.amountOwedCents} />
      {payment.canPay ? (
        <div className="ode-pay-row">
          <label>
            Pay {friend} ($){" "}
            <input inputMode="decimal" value={amount} placeholder="0.00" onChange={(e) => setAmount(e.target.value)} />
          </label>
          {clientId === null && (
            <button className="primary" onClick={() => void payWithoutPayPal()} disabled={paying}>
              {paying ? "Paying…" : `Pay ${friend}`}
            </button>
          )}
          {clientId === undefined && <span className="ode-loading">Loading PayPal…</span>}
          {usesPayPal && <div ref={container} className="ode-pay-paypal" />}
        </div>
      ) : (
        <button disabled>{friend} is fully repaid</button>
      )}
      {problem !== null && (
        <p role="alert" className="ode-problem">
          {problem}
        </p>
      )}
    </div>
  );
}
