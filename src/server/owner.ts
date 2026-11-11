import { err, ok, type Result } from "./result.ts";
import { parseVisitorId, type InvalidVisitorId, type VisitorId } from "./visitor-id.ts";

/** The owner of the Seeded Ode: the payer's own Ode, which every visitor starts on. */
export const SEEDED = "seeded" as const;

/**
 * Whose Ode a ledger, its lyrics, its Ode and its run belong to: the Seeded Ode, or the Ode one judge made from their own
 * notes. A judge's Ode is owned by the judge's visitor ID.
 */
export type Owner = typeof SEEDED | VisitorId;

/** What differs between the Seeded Ode and a judge's own Ode. The one place that tells them apart, so no caller compares an owner to `SEEDED`. */
export interface OwnerPolicy {
  /**
   * The visitor whose payments count in the Ode: for the Seeded Ode each visitor's own copy, so whoever is looking; for a
   * judge's Ode the judge's, so a friend opening the judge's link on their phone sees what the judge paid.
   *
   * @param viewer - The visitor making the request.
   */
  copyOf(viewer: VisitorId): VisitorId;
  /** Whether the friends are paid by name (the Seeded Ode's) or by their place on the ledger, whatever the notes call them (a judge's). */
  readonly friendsPaidByName: boolean;
  /** Whether starting this Ode counts against the day's cap: only a judge's does, since the Seeded Ode is the payer's own. */
  readonly countsAgainstCap: boolean;
}

/**
 * The policy for one owner's Ode.
 *
 * @param owner - Whose Ode.
 */
export function policyOf(owner: Owner): OwnerPolicy {
  if (owner === SEEDED) return { copyOf: (viewer) => viewer, friendsPaidByName: true, countsAgainstCap: false };
  return { copyOf: () => owner, friendsPaidByName: false, countsAgainstCap: true };
}

/**
 * Read an owner from a stored row.
 *
 * @param input - Anything; only `SEEDED` or a visitor ID is an owner.
 * @returns The owner, or `InvalidVisitorId` for anything else.
 */
export function parseOwner(input: unknown): Result<Owner, InvalidVisitorId> {
  if (input === SEEDED) return ok(SEEDED);
  const visitor = parseVisitorId(input);
  return visitor._tag === "ok" ? ok(visitor.value) : err(visitor.error);
}

/**
 * Read the owner a store row holds. Only the stores write owners, and they write an `Owner`, so a bad one is a corrupt row.
 *
 * @param table - The table the row came from, for the message.
 * @param stored - The row's `owner` column.
 * @returns The owner.
 */
export function ownerOfRow(table: string, stored: string): Owner {
  const owner = parseOwner(stored);
  // Defect: only this store writes owner, and it writes an Owner.
  if (owner._tag === "err") throw new Error(`corrupt ${table} row: ${stored} is not an owner`);
  return owner.value;
}
