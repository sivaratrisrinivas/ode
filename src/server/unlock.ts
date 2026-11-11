import { LINES_PER_VERSE } from "./lyrics.ts";

/**
 * How many of a friend's lines are unlocked: each 25% of the amount owed unlocks the next line, in order.
 *
 * @param owedCents - What the payer owes the friend, in cents; positive.
 * @param repaidCents - What the payer has sent the friend, counted before fees.
 * @returns A number from 0 to `LINES_PER_VERSE`; the lines unlocked are the first that many.
 */
export function linesUnlocked(owedCents: number, repaidCents: number): number {
  return Math.min(LINES_PER_VERSE, Math.floor((repaidCents * LINES_PER_VERSE) / owedCents));
}

/**
 * The amount repaid at which the next line unlocks, rounded up to the cent so that paying it unlocks the line.
 *
 * @returns The amount in cents, or undefined when every line is already unlocked.
 */
export function nextLineAtCents(owedCents: number, repaidCents: number): number | undefined {
  const unlocked = linesUnlocked(owedCents, repaidCents);
  if (unlocked === LINES_PER_VERSE) return undefined;
  return Math.ceil(((unlocked + 1) * owedCents) / LINES_PER_VERSE);
}

/**
 * Whether the chorus has dropped: every friend with an amount owed is fully repaid. The payer's page and each
 * friend's page both ask this, so they cannot disagree about when the Ode is complete.
 *
 * @param standings - Each friend who has an amount owed; a friend with none (missing or covered) is not on the list.
 * @returns False with no friends, so an empty ledger never drops a chorus.
 */
export function chorusDropped(standings: readonly { amountOwedCents: number; amountRepaidCents: number }[]): boolean {
  return standings.length > 0 && standings.every((standing) => standing.amountRepaidCents >= standing.amountOwedCents);
}
