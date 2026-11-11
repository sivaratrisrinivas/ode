import { LINES_PER_VERSE } from "./lyrics.ts";
import { daysUntil, type ReleaseDate } from "./release-date.ts";

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

/**
 * The chorus, locked until every friend is fully repaid. The one place the payer's page and a friend's page decide
 * this, so they cannot disagree.
 *
 * @param chorus - The chorus section.
 * @param standings - Each friend who has an amount owed.
 * @returns The chorus with `locked` set; locked when `chorusDropped` is false, so with no standings it stays locked.
 */
export function withChorusLock<Chorus extends object>(chorus: Chorus, standings: readonly { amountOwedCents: number; amountRepaidCents: number }[]) {
  return { ...chorus, locked: !chorusDropped(standings) };
}

/** Where the Ode stands against its release date, as the payer's page and each friend's page both show it. */
export interface ReleaseStatus {
  /** The promised date, `YYYY-MM-DD`. */
  date: ReleaseDate;
  /** Whole days left, 0 on the release day; null once the date has passed or the chorus has dropped. */
  daysToDrop: number | null;
  /** The date has passed with a friend still unpaid. The chorus stays locked either way; only full repayment drops it. */
  delayed: boolean;
  /** The line to show ("1 of 3 friends · 22 days to drop"); null once the chorus has dropped. */
  countdown: string | null;
}

/**
 * The release date's countdown, or its delayed state. One function for both readers, so they cannot disagree.
 *
 * @param date - The release date.
 * @param now - The current time.
 * @param standings - Each friend who has an amount owed.
 * @returns Not delayed and no countdown once every friend is repaid, whenever that happens; otherwise delayed when the
 *   release day is over, and the days left until then.
 */
export function releaseStatus(
  date: ReleaseDate,
  now: Date,
  standings: readonly { amountOwedCents: number; amountRepaidCents: number }[],
): ReleaseStatus {
  if (chorusDropped(standings)) return { date, daysToDrop: null, delayed: false, countdown: null };

  const repaid = standings.filter((standing) => standing.amountRepaidCents >= standing.amountOwedCents).length;
  const friends = `${repaid} of ${standings.length} friends`;
  const days = daysUntil(date, now);
  if (days < 0) return { date, daysToDrop: null, delayed: true, countdown: `Delayed · ${friends} repaid · was due ${date}` };

  const left = days === 0 ? "drops today" : days === 1 ? "1 day to drop" : `${days} days to drop`;
  return { date, daysToDrop: days, delayed: false, countdown: `${friends} · ${left}` };
}
