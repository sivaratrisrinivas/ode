import {
  buildLedger,
  parseExtraction,
  UnknownFriend,
  type AmountStatus,
  type Ledger,
  type LedgerRow,
  type MalformedExtraction,
  type RowEdit,
  type TooManyFriends,
} from "./ledger.ts";
import type { Claude, ClaudeUnavailable, JsonSchema } from "./ports.ts";
import { err, ok, type Result } from "./result.ts";
import type { TripNotes } from "./trip-notes.ts";

/** The ledger as saved: the notes it came from, the rows in notes order, and the ledger-level warnings. */
export interface StoredLedger extends Ledger {
  readonly notes: string;
}

/** What the ledger service needs from storage for the one ledger. */
export interface LedgerStore {
  /** The saved ledger; empty when no notes have been turned into a ledger yet. */
  read(): Promise<StoredLedger>;
  /** Replace the whole ledger atomically. Lyrics written from the old ledger are deleted with it. */
  replace(ledger: StoredLedger): Promise<void>;
  /** Write the given fields to one friend's row; undefined when no such friend is on the ledger. */
  updateRow(
    friend: string,
    fields: { amountOwedCents?: number; amountStatus?: AmountStatus; insideJoke?: string },
  ): Promise<LedgerRow | undefined>;
}

const instructions = `You read a payer's free-text trip notes and extract who they owe. "Me" and "I" are the payer.

friends: every friend the payer owes money to (never the payer). For each friend:
- name: as written in the notes, capitalised.
- amountOwedCents: in cents, what the payer owes this friend before any group cost is subtracted. Add up everything this friend paid for the payer. When the friend paid a total shared by several people, use the payer's share of it (a $420 stay split 4 ways is $105, so 10500). null when the notes give no amount.
- amountIsEstimate: true when the amount is vague ("$90ish", "~105", "I think", "maybe"); then amountOwedCents is your best proposed number.
- insideJoke: one short trip memory about this friend taken from the notes, in at most 15 words. null when the notes hold none.

groupCosts: costs the payer covered for the whole group (for example "I paid the parking, $30"), each with the total cost in cents, not anyone's share. Leave out costs a friend paid. amountCents is null when the notes give no amount.

Never invent a friend, an amount or a memory that the notes do not contain.`;

const nullable = (type: string) => ({ type: [type, "null"] });

const schema: JsonSchema = {
  type: "object",
  properties: {
    friends: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amountOwedCents: nullable("integer"),
          amountIsEstimate: { type: "boolean" },
          insideJoke: nullable("string"),
        },
        required: ["name", "amountOwedCents", "amountIsEstimate", "insideJoke"],
        additionalProperties: false,
      },
    },
    groupCosts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          amountCents: nullable("integer"),
        },
        required: ["description", "amountCents"],
        additionalProperties: false,
      },
    },
  },
  required: ["friends", "groupCosts"],
  additionalProperties: false,
};

/** Why trip notes could not become a ledger. */
export type ProposeLedgerError = ClaudeUnavailable | MalformedExtraction | TooManyFriends;

/**
 * Turn trip notes into a ledger and save it in place of the current one.
 * Claude extracts; the even split of group costs is deterministic code.
 * Lyrics written from the old ledger are deleted. Nothing is saved when this fails.
 *
 * @param deps - Claude and the ledger store.
 * @param notes - The payer's parsed trip notes.
 * @returns The saved ledger, or why the notes could not be used.
 */
export async function proposeLedger(
  deps: { claude: Claude; store: LedgerStore },
  notes: TripNotes,
): Promise<Result<StoredLedger, ProposeLedgerError>> {
  const reply = await deps.claude.structured({ task: "extract-ledger", instructions, schema, input: notes });
  if (reply._tag === "err") return err(reply.error);

  const extraction = parseExtraction(reply.value);
  if (extraction._tag === "err") return err(extraction.error);

  const ledger = buildLedger(extraction.value);
  if (ledger._tag === "err") return err(ledger.error);

  const stored: StoredLedger = { notes, ...ledger.value };
  await deps.store.replace(stored);
  return ok(stored);
}

/**
 * Apply the payer's edit to one friend's row. A typed amount replaces a proposed one,
 * so it counts as stated and its warning goes away.
 *
 * @param store - The ledger store.
 * @param friend - The friend whose row changes.
 * @param edit - The parsed edit.
 * @returns The updated row, or `UnknownFriend`.
 */
export async function editLedgerRow(
  store: LedgerStore,
  friend: string,
  edit: RowEdit,
): Promise<Result<LedgerRow, UnknownFriend>> {
  const row = await store.updateRow(friend, {
    ...edit,
    ...(edit.amountOwedCents === undefined ? {} : { amountStatus: "stated" as const }),
  });
  return row === undefined ? err(new UnknownFriend(friend)) : ok(row);
}
