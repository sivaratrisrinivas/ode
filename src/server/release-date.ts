import { err, ok, type Result } from "./result.ts";

/** A calendar date, `YYYY-MM-DD`, in UTC: the day the payer promises the whole Ode will drop. Only `parseReleaseDate` makes one. */
export type ReleaseDate = string & { readonly __brand: "ReleaseDate" };

/** The text is not a release date the payer can promise. */
export class InvalidReleaseDate extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "InvalidReleaseDate" as const;

  /** @param message - What is wrong with the date, for the payer. */
  constructor(message: string) {
    super(message);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The UTC day number (days since 1970-01-01) of a `YYYY-MM-DD` text, or undefined when it is not a real calendar date. */
function dayNumber(text: string): number | undefined {
  const match = DATE.exec(text);
  if (match === null) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  // Date.UTC rolls an impossible date (Feb 30) over into the next month; a real one comes back unchanged.
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? ms / DAY_MS : undefined;
}

/** The UTC day number of a moment. */
function today(now: Date): number {
  return Math.floor(now.getTime() / DAY_MS);
}

/**
 * Parse the release date the payer chose when making the Ode.
 *
 * @param input - Anything; only a real calendar date written `YYYY-MM-DD` is accepted.
 * @param now - The current time; the date may be today (UTC) or later, never a day already past.
 * @returns The release date, or `InvalidReleaseDate` saying what to fix.
 */
export function parseReleaseDate(input: unknown, now: Date): Result<ReleaseDate, InvalidReleaseDate> {
  const day = typeof input === "string" ? dayNumber(input) : undefined;
  if (typeof input !== "string" || day === undefined) return err(new InvalidReleaseDate("Send the release date as a real date written YYYY-MM-DD."));
  if (day < today(now)) return err(new InvalidReleaseDate("The release date can't be in the past."));
  // SAFETY: TypeScript cannot express the brand. The checks above make `input` a real YYYY-MM-DD date that is not in the past, and this is the only place that makes one.
  return ok(input as ReleaseDate);
}

/**
 * How many UTC days from now to the release date: 0 on the release day itself, so that day is not yet late, and
 * negative once it has passed.
 *
 * @param date - The release date.
 * @param now - The current time.
 */
export function daysUntil(date: ReleaseDate, now: Date): number {
  const day = dayNumber(date);
  // Defect: a ReleaseDate is only made by `parseReleaseDate`, which accepts nothing but a real date.
  if (day === undefined) throw new Error(`corrupt release date: ${date}`);
  return day - today(now);
}
