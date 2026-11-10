import type { FriendAccounts } from "./friend-accounts.ts";
import type { LedgerStore } from "./ledger-service.ts";
import { UnknownFriend } from "./ledger.ts";
import { PayPalUnavailable, type PayPal } from "./ports.ts";
import { err, ok, type Result } from "./result.ts";
import { linesUnlocked, nextLineAtCents } from "./unlock.ts";

/** What the payments service needs from storage: each captured payment, kept for good. */
export interface PaymentStore {
  /** Gross cents captured so far for each friend who has been paid anything; not capped at what is owed. */
  totals(): Promise<ReadonlyMap<string, number>>;
  /** Record a capture. A capture ID already recorded changes nothing, so the same payment is never counted twice. */
  record(payment: { captureId: string; orderId: string; friend: string; amountCents: number }): Promise<void>;
  /** Whether a capture of this order has been recorded, whichever of the capture response and the webhook recorded it. */
  hasOrder(orderId: string): Promise<boolean>;
  /** Whether this capture has been recorded. */
  hasCapture(captureId: string): Promise<boolean>;
}

/** A completed capture as PayPal's webhook reports it. `amountCents` is gross, before PayPal's fee. */
export interface CapturedPayment {
  captureId: string;
  orderId: string;
  amountCents: number;
}

/** Where one friend stands: what is owed, what has been repaid and which of their lines are unlocked. */
export interface FriendStanding {
  readonly friend: string;
  readonly amountOwedCents: number;
  /** Counted before fees, and never more than `amountOwedCents`. */
  readonly amountRepaidCents: number;
  /** The first this many of the friend's four lines are unlocked. */
  readonly linesUnlocked: number;
  /** The amount repaid at which the next line unlocks, rounded up to the cent; null once every line is unlocked. */
  readonly nextLineAtCents: number | null;
  /** False once the friend is fully repaid. */
  readonly canPay: boolean;
}

/** The amount is not a whole number of cents of at least 1. */
export class InvalidPayment extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "InvalidPayment" as const;

  constructor() {
    super("Enter an amount in whole cents, at least 1.");
  }
}

/** The friend has no amount owed to pay against. */
export class NothingOwed extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "NothingOwed" as const;

  /** @param friend - The friend whose row has no amount. */
  constructor(friend: string) {
    super(`Enter what you owe ${friend} on the ledger before paying them.`);
  }
}

/** The friend is fully repaid, so there is nothing left to pay. */
export class FullyRepaid extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "FullyRepaid" as const;

  /** @param friend - The friend who is fully repaid. */
  constructor(friend: string) {
    super(`${friend} is fully repaid.`);
  }
}

/** The amount is more than the friend is still owed. */
export class AmountTooHigh extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "AmountTooHigh" as const;

  /**
   * @param friend - The friend being paid.
   * @param remainingCents - What is still owed to them; positive.
   */
  constructor(friend: string, remainingCents: number) {
    super(`${friend} is owed ${dollars(remainingCents)} more. Pay that or less.`);
  }
}

/** No PayPal sandbox account is set up to pay this friend. */
export class NoPayPalAccount extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "NoPayPalAccount" as const;

  /** @param friend - The friend without an account. */
  constructor(friend: string) {
    super(`No PayPal account is set up to pay ${friend}.`);
  }
}

/** The order is not one that pays a friend on the ledger. */
export class NotAFriendsOrder extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "NotAFriendsOrder" as const;

  constructor() {
    super("That PayPal order doesn't pay one of your friends.");
  }
}

/** PayPal declined the payment; no money moved. */
export class PaymentDeclined extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "PaymentDeclined" as const;

  constructor() {
    super("Your payment didn't go through. Nothing was sent.");
  }
}

/** Why an order could not be created. */
export type CreateOrderError = UnknownFriend | NothingOwed | FullyRepaid | InvalidPayment | AmountTooHigh | NoPayPalAccount | PayPalUnavailable;

/** Why an order could not be captured. */
export type CaptureError = NotAFriendsOrder | NothingOwed | FullyRepaid | AmountTooHigh | PaymentDeclined | PayPalUnavailable;

/** Paying friends back through PayPal, and where each friend stands as a result. */
export interface Payments {
  /**
   * Every friend with an amount owed, in ledger order, with their lines unlocked so far.
   *
   * @returns The standings; empty when the ledger is empty.
   */
  standings(): Promise<readonly FriendStanding[]>;
  /**
   * Create a PayPal order paying `friend` `amountCents`. Nothing is paid until the order is captured.
   *
   * @param friend - The friend's name as on the ledger.
   * @param amountCents - Untrusted: it must be a whole number of cents, at least 1 and no more than still owed.
   * @returns The new order's ID, or why none was made. A friend already fully repaid is reported before the amount is judged.
   */
  createOrder(friend: string, amountCents: unknown): Promise<Result<string, CreateOrderError>>;
  /**
   * Capture an order the payer approved, and record it. The same order captured again counts once.
   *
   * @param orderId - The PayPal order ID the page was given.
   * @returns The paid friend's new standing, or why no payment was counted: a declined payment sent nothing.
   */
  capture(orderId: string): Promise<Result<FriendStanding, CaptureError>>;
  /**
   * Count a capture PayPal's webhook says completed. Money has moved, so it counts even past what is owed (the amount
   * repaid is capped when read), and a capture the capture response already recorded, or an earlier delivery of
   * the same event, changes nothing.
   *
   * @param payment - The capture; the order it belongs to is read back to find which friend it paid.
   * @returns "recorded", or "ignored" for an order that did not pay a friend on the ledger. A PayPal that cannot be
   *   reached is an error, so the webhook can be asked to deliver again.
   */
  confirm(payment: CapturedPayment): Promise<Result<"recorded" | "ignored", PayPalUnavailable>>;
}

/** A dollar amount for a message to the payer: 4750 is "$47.50". */
function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Create the payments service.
 *
 * @param deps - The ledger, the stored payments, PayPal, and which account pays which friend.
 */
export function createPayments(deps: { ledger: Pick<LedgerStore, "read">; store: PaymentStore; paypal: PayPal; accounts: FriendAccounts }): Payments {
  async function standings(): Promise<FriendStanding[]> {
    const [ledger, totals] = await Promise.all([deps.ledger.read(), deps.store.totals()]);
    return ledger.rows.flatMap((row) => {
      if (row.amountOwedCents === null) return [];
      const owed = row.amountOwedCents;
      // The amount repaid never exceeds the amount owed, even if the amount owed was edited down after payments.
      const repaid = Math.min(owed, totals.get(row.friend) ?? 0);
      return [
        {
          friend: row.friend,
          amountOwedCents: owed,
          amountRepaidCents: repaid,
          linesUnlocked: linesUnlocked(owed, repaid),
          nextLineAtCents: nextLineAtCents(owed, repaid) ?? null,
          canPay: repaid < owed,
        },
      ];
    });
  }

  /** The friend's standing, or why they cannot be paid anything: unknown, no amount owed, or already repaid. */
  async function payable(friend: string): Promise<Result<FriendStanding, UnknownFriend | NothingOwed | FullyRepaid>> {
    const standing = (await standings()).find((candidate) => candidate.friend === friend);
    if (standing !== undefined) return standing.canPay ? ok(standing) : err(new FullyRepaid(friend));
    const ledger = await deps.ledger.read();
    return err(ledger.rows.some((row) => row.friend === friend) ? new NothingOwed(friend) : new UnknownFriend(friend));
  }

  function within(standing: FriendStanding, amountCents: number): AmountTooHigh | undefined {
    const remaining = standing.amountOwedCents - standing.amountRepaidCents;
    return amountCents > remaining ? new AmountTooHigh(standing.friend, remaining) : undefined;
  }

  /** The friend's standing, right after a payment to them was recorded. */
  async function standingOf(friend: string): Promise<FriendStanding> {
    const standing = (await standings()).find((candidate) => candidate.friend === friend);
    // Defect: `record` just stored a payment for a friend who had an amount owed a moment ago; only a ledger rebuilt mid-request removes them.
    if (standing === undefined) throw new Error(`${friend} left the ledger while their payment was recorded`);
    return standing;
  }

  return {
    standings,

    async createOrder(friend, amountCents) {
      const standing = await payable(friend);
      if (standing._tag === "err") return standing;
      if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents < 1) return err(new InvalidPayment());
      const tooHigh = within(standing.value, amountCents);
      if (tooHigh !== undefined) return err(tooHigh);
      const email = deps.accounts.emailFor(friend);
      if (email === undefined) return err(new NoPayPalAccount(friend));

      const order = await deps.paypal.createOrder({ friendEmail: email, amountCents });
      return order._tag === "ok" ? ok(order.value.orderId) : order;
    },

    async capture(orderId) {
      // The order is read back first: the payee decides which friend is paid, and nothing the page says does.
      const order = await deps.paypal.getOrder(orderId);
      if (order._tag === "err") return order;
      const friend = deps.accounts.friendFor(order.value.friendEmail);
      if (friend === undefined) return err(new NotAFriendsOrder());

      // The webhook got here first: this payment is already counted, so the response changes nothing.
      if (await deps.store.hasOrder(orderId)) {
        const counted = (await standings()).find((candidate) => candidate.friend === friend);
        // The payment was recorded earlier; a ledger rebuilt since has dropped the friend it paid.
        return counted === undefined ? err(new NotAFriendsOrder()) : ok(counted);
      }

      const standing = await payable(friend);
      // A payee who is no longer on the ledger is not one of the friends this order can pay.
      if (standing._tag === "err") return err(standing.error._tag === "UnknownFriend" ? new NotAFriendsOrder() : standing.error);
      const tooHigh = within(standing.value, order.value.amountCents);
      if (tooHigh !== undefined) return err(tooHigh);

      const capture = await deps.paypal.captureOrder(orderId);
      if (capture._tag === "err") return capture;
      if (capture.value.status === "DECLINED") return err(new PaymentDeclined());

      // The capture's amount is gross, before PayPal's fee, and the same capture ID is only ever counted once.
      await deps.store.record({ captureId: capture.value.captureId, orderId, friend, amountCents: capture.value.amountCents });
      return ok(await standingOf(friend));
    },

    async confirm({ captureId, orderId, amountCents }) {
      // A delivery of an event already counted needs nothing from PayPal, so a PayPal outage cannot fail it.
      if (await deps.store.hasCapture(captureId)) return ok("recorded");
      const order = await deps.paypal.getOrder(orderId);
      if (order._tag === "err") return order;
      const friend = deps.accounts.friendFor(order.value.friendEmail);
      if (friend === undefined) return ok("ignored");
      const ledger = await deps.ledger.read();
      // A friend with no amount owed, or none on the ledger any more, has no lines this payment could unlock.
      if (!ledger.rows.some((row) => row.friend === friend && row.amountOwedCents !== null)) return ok("ignored");
      await deps.store.record({ captureId, orderId, friend, amountCents });
      return ok("recorded");
    },
  };
}
