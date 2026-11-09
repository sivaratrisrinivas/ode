import { err, ok, type Result } from "./result.ts";

/** Judge Odes allow 1–3 friends (one sandbox friend account each). */
export const MAX_FRIENDS = 3;

/** Longest inside joke accepted, in characters. */
export const MAX_JOKE_LENGTH = 280;

/** Largest amount owed accepted, in cents ($100,000). */
export const MAX_AMOUNT_CENTS = 10_000_000;

/**
 * Where a friend's amount owed came from:
 * - `stated`: a clear figure in the notes, or one the payer typed in
 * - `estimated`: a proposed number from vague notes ("$90ish")
 * - `missing`: the notes gave no amount
 * - `covered`: group costs the payer covered cancel out the whole amount
 */
export type AmountStatus = "stated" | "estimated" | "missing" | "covered";

/** One friend on the ledger. `amountOwedCents` is null exactly when the status is `missing` or `covered`. */
export interface LedgerRow {
  readonly friend: string;
  readonly amountOwedCents: number | null;
  readonly amountStatus: AmountStatus;
  readonly insideJoke: string;
}

/** A proposed ledger: the rows plus anything the notes left unclear. */
export interface Ledger {
  readonly rows: readonly LedgerRow[];
  readonly warnings: readonly string[];
}

/** A friend as Claude read them from the trip notes, before group costs. */
export interface ExtractedFriend {
  readonly name: string;
  /** What the payer owes this friend before group costs are subtracted; null when the notes give none. */
  readonly amountOwedCents: number | null;
  readonly amountIsEstimate: boolean;
  readonly insideJoke: string | null;
}

/** A cost the payer covered for the whole group. */
export interface GroupCost {
  readonly description: string;
  readonly amountCents: number | null;
}

/** Claude's reading of the trip notes. */
export interface Extraction {
  readonly friends: readonly ExtractedFriend[];
  readonly groupCosts: readonly GroupCost[];
}

/** Claude's reply did not have the shape the schema promised. */
export class MalformedExtraction extends Error {
  readonly _tag = "MalformedExtraction" as const;

  constructor(detail: string) {
    super(`Claude's reading of the notes was malformed: ${detail}`);
  }
}

/** The notes name more friends than an Ode supports. */
export class TooManyFriends extends Error {
  readonly _tag = "TooManyFriends" as const;
  readonly names: readonly string[];

  constructor(names: readonly string[]) {
    super(
      `Ode takes up to ${MAX_FRIENDS} friends, but your notes name ${names.length}: ${names.join(", ")}. ` +
        `Trim the notes to ${MAX_FRIENDS} friends and try again.`,
    );
    this.names = names;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asList(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function parseCents(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_AMOUNT_CENTS) return value;
  return undefined;
}

/**
 * Parse Claude's reply into an extraction.
 *
 * @param raw - The structured output exactly as Claude returned it.
 * @returns The extraction, or `MalformedExtraction` naming the first problem found.
 */
export function parseExtraction(raw: unknown): Result<Extraction, MalformedExtraction> {
  const friendsRaw = asList(isRecord(raw) ? raw["friends"] : undefined);
  const groupCostsRaw = asList(isRecord(raw) ? raw["groupCosts"] : undefined);
  if (friendsRaw === undefined || groupCostsRaw === undefined) {
    return err(new MalformedExtraction("expected friends and groupCosts lists"));
  }

  const friends: ExtractedFriend[] = [];
  const seen = new Set<string>();
  for (const item of friendsRaw) {
    if (!isRecord(item)) return err(new MalformedExtraction("a friend is not an object"));
    const name = typeof item["name"] === "string" ? item["name"].trim() : "";
    const amountOwedCents = parseCents(item["amountOwedCents"]);
    const joke = item["insideJoke"];
    if (name === "") return err(new MalformedExtraction("a friend has no name"));
    if (amountOwedCents === undefined) return err(new MalformedExtraction(`${name} has an invalid amount`));
    if (typeof item["amountIsEstimate"] !== "boolean") {
      return err(new MalformedExtraction(`${name} has no amountIsEstimate flag`));
    }
    if (joke !== null && typeof joke !== "string") return err(new MalformedExtraction(`${name} has an invalid joke`));
    if (seen.has(name.toLowerCase())) return err(new MalformedExtraction(`${name} appears twice`));
    seen.add(name.toLowerCase());
    friends.push({
      name,
      amountOwedCents,
      amountIsEstimate: item["amountIsEstimate"],
      insideJoke: joke === null ? null : joke.trim().slice(0, MAX_JOKE_LENGTH),
    });
  }

  const groupCosts: GroupCost[] = [];
  for (const item of groupCostsRaw) {
    if (!isRecord(item)) return err(new MalformedExtraction("a group cost is not an object"));
    const description = typeof item["description"] === "string" ? item["description"].trim() : "";
    const amountCents = parseCents(item["amountCents"]);
    if (description === "") return err(new MalformedExtraction("a group cost has no description"));
    if (amountCents === undefined) return err(new MalformedExtraction(`${description} has an invalid amount`));
    groupCosts.push({ description, amountCents });
  }

  return ok({ friends, groupCosts });
}

/**
 * Build the proposed ledger from an extraction.
 *
 * Group costs the payer covered are split evenly between the payer and every friend,
 * and each friend's share is subtracted from what the payer owes that friend.
 *
 * @param extraction - Claude's reading of the notes.
 * @returns The ledger with warnings for anything missing, or `TooManyFriends`.
 */
export function buildLedger(extraction: Extraction): Result<Ledger, TooManyFriends> {
  const { friends, groupCosts } = extraction;
  if (friends.length > MAX_FRIENDS) return err(new TooManyFriends(friends.map((f) => f.name)));

  const warnings: string[] = [];
  if (friends.length === 0) {
    warnings.push("No friends found in the notes. Say who covered what and try again.");
  }

  let groupTotal = 0;
  for (const cost of groupCosts) {
    if (cost.amountCents === null || cost.amountCents === 0) {
      warnings.push(`No amount found for the group cost "${cost.description}", so it was not subtracted.`);
    } else {
      groupTotal += cost.amountCents;
    }
  }
  // The payer takes a share too, so a cost splits across friends + 1 people.
  const sharePerFriend = Math.round(groupTotal / (friends.length + 1));

  const rows = friends.map((friend): LedgerRow => {
    const insideJoke = friend.insideJoke ?? "";
    if (friend.amountOwedCents === null || friend.amountOwedCents === 0) {
      return { friend: friend.name, amountOwedCents: null, amountStatus: "missing", insideJoke };
    }
    const net = friend.amountOwedCents - sharePerFriend;
    if (net <= 0) {
      return { friend: friend.name, amountOwedCents: null, amountStatus: "covered", insideJoke };
    }
    return {
      friend: friend.name,
      amountOwedCents: net,
      amountStatus: friend.amountIsEstimate ? "estimated" : "stated",
      insideJoke,
    };
  });

  return ok({ rows, warnings });
}

/**
 * The warnings to show on one row.
 *
 * @param row - A ledger row.
 * @returns Messages for a missing, covered or estimated amount and a missing inside joke.
 */
export function rowWarnings(row: LedgerRow): string[] {
  const warnings: string[] = [];
  if (row.amountStatus === "missing") {
    warnings.push(`No amount found for ${row.friend}. Enter what you owe them.`);
  } else if (row.amountStatus === "covered") {
    warnings.push(
      `The group costs you covered cancel out what you owe ${row.friend}. Enter an amount if you still owe them.`,
    );
  } else if (row.amountStatus === "estimated") {
    warnings.push(`${row.friend}'s amount is a proposed number from vague notes. Check it.`);
  }
  if (row.insideJoke === "") warnings.push(`No inside joke found for ${row.friend}. Write one.`);
  return warnings;
}

/** A payer's change to one ledger row. At least one field is set. */
export interface RowEdit {
  readonly amountOwedCents?: number;
  readonly insideJoke?: string;
}

/** The edit names a friend who is not on the ledger. */
export class UnknownFriend extends Error {
  readonly _tag = "UnknownFriend" as const;

  constructor(friend: string) {
    super(`${friend} is not on the ledger.`);
  }
}

/** The submitted edit cannot be applied to a ledger row. */
export class InvalidRowEdit extends Error {
  readonly _tag = "InvalidRowEdit" as const;
}

/**
 * Parse an untrusted edit request.
 *
 * @param input - The request body.
 * @returns The edit, or `InvalidRowEdit` with a message for the payer.
 */
export function parseRowEdit(input: unknown): Result<RowEdit, InvalidRowEdit> {
  if (!isRecord(input)) return err(new InvalidRowEdit("Send the fields to change as JSON."));
  const { amountOwedCents, insideJoke } = input;
  if (amountOwedCents === undefined && insideJoke === undefined) {
    return err(new InvalidRowEdit("Send an amountOwedCents or an insideJoke to change."));
  }

  let edit: { amountOwedCents?: number; insideJoke?: string } = {};
  if (amountOwedCents !== undefined) {
    if (
      typeof amountOwedCents !== "number" ||
      !Number.isInteger(amountOwedCents) ||
      amountOwedCents < 1 ||
      amountOwedCents > MAX_AMOUNT_CENTS
    ) {
      return err(new InvalidRowEdit("The amount owed must be between $0.01 and $100,000.00."));
    }
    edit = { ...edit, amountOwedCents };
  }
  if (insideJoke !== undefined) {
    if (typeof insideJoke !== "string" || insideJoke.trim().length > MAX_JOKE_LENGTH) {
      return err(new InvalidRowEdit(`The inside joke must be text of at most ${MAX_JOKE_LENGTH} characters.`));
    }
    edit = { ...edit, insideJoke: insideJoke.trim() };
  }
  return ok(edit);
}
