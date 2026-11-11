import { err, ok, type Result } from "./result.ts";
import { parseVisitorId, type InvalidVisitorId, type VisitorId } from "./visitor-id.ts";

/** The owner of the Seeded Ode: the payer's own Ode, which every visitor starts on. */
export const SEEDED = "seeded" as const;

/**
 * Whose Ode a ledger, its lyrics, its Ode and its run belong to: the Seeded Ode, or the Ode one judge made from their own
 * notes. A judge's Ode is owned by the judge's visitor ID.
 */
export type Owner = typeof SEEDED | VisitorId;

/**
 * The visitor whose payments count in an Ode: for the Seeded Ode each visitor's own copy, so whoever is looking; for a judge's
 * Ode the judge's, so a friend opening the judge's link on their phone sees what the judge paid.
 *
 * @param owner - Whose Ode is being read.
 * @param viewer - The visitor making the request.
 */
export function copyOf(owner: Owner, viewer: VisitorId): VisitorId {
  return owner === SEEDED ? viewer : owner;
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
