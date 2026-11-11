import { err, ok, type Result } from "./result.ts";

/** Which PayPal account pays which friend, in both directions; names and emails match whatever their case. */
export interface FriendAccounts {
  /** The account that pays `friend`; undefined when none is set up. */
  emailFor(friend: string): string | undefined;
  /** The friend an account pays, as the name they were set up under; undefined when it is nobody's. */
  friendFor(email: string): string | undefined;
  /** Every account, in the order they were set up. */
  emails(): readonly string[];
}

/** The friend accounts setting could not be read. */
export class InvalidFriendAccounts extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "InvalidFriendAccounts" as const;

  /** @param entry - The part of the setting that is not `Name=email`. */
  constructor(entry: string) {
    super(`FRIEND_PAYPAL_ACCOUNTS must list Name=email pairs separated by commas; could not read "${entry}".`);
  }
}

/**
 * Build the lookup from friend names to the PayPal accounts that pay them.
 *
 * @param accounts - Each friend's name and the account that pays them.
 * @returns A lookup that ignores letter case in names and emails.
 */
export function friendAccounts(accounts: Readonly<Record<string, string>>): FriendAccounts {
  const byName = new Map(Object.entries(accounts).map(([name, email]) => [name.toLowerCase(), email]));
  const byEmail = new Map(Object.entries(accounts).map(([name, email]) => [email.toLowerCase(), name]));
  return {
    emailFor: (friend) => byName.get(friend.toLowerCase()),
    friendFor: (email) => byEmail.get(email.toLowerCase()),
    emails: () => Object.values(accounts),
  };
}

/**
 * Pair a judge's friends with the sandbox accounts by place: the first friend on the ledger is paid through the first account,
 * the second through the second, and so on. A judge's friends have whatever names their notes gave them, so names cannot say
 * which account pays them.
 *
 * @param accounts - The sandbox accounts, in the order they were set up.
 * @param friends - The friends on the judge's ledger, in ledger order.
 * @returns A lookup in which a friend with no account at their place (more friends than accounts) is paid by nobody.
 */
export function pairedInOrder(accounts: FriendAccounts, friends: readonly string[]): FriendAccounts {
  const emails = accounts.emails();
  const paired = Object.fromEntries(friends.flatMap((friend, place) => (emails[place] === undefined ? [] : [[friend, emails[place]]])));
  return friendAccounts(paired);
}

/**
 * Read the `FRIEND_PAYPAL_ACCOUNTS` setting: `Name=email` pairs separated by commas.
 *
 * @param setting - The setting's value; blank or missing means no accounts.
 * @returns The lookup, or `InvalidFriendAccounts` naming the first entry that is not a pair.
 */
export function parseFriendAccounts(setting: string | undefined): Result<FriendAccounts, InvalidFriendAccounts> {
  const accounts: Record<string, string> = {};
  for (const entry of (setting ?? "").split(",").map((part) => part.trim()).filter((part) => part !== "")) {
    const [name, email, ...rest] = entry.split("=").map((part) => part.trim());
    if (!name || !email || rest.length > 0) return err(new InvalidFriendAccounts(entry));
    accounts[name] = email;
  }
  return ok(friendAccounts(accounts));
}
