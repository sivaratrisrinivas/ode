import { DEFAULT_TRIP, type AmountStatus, type LedgerRow } from "./ledger.ts";
import type { LedgerStore, StoredLedger } from "./ledger-service.ts";
import { ownerOfRow, type Owner } from "./owner.ts";
import type { Sql } from "./ports.ts";
import { isTokenShaped } from "./token.ts";

interface FriendRecord {
  friend: string;
  amount_owed_cents: number | null;
  amount_status: AmountStatus;
  inside_joke: string;
}

function toRow(record: FriendRecord): LedgerRow {
  return {
    friend: record.friend,
    amountOwedCents: record.amount_owed_cents,
    amountStatus: record.amount_status,
    insideJoke: record.inside_joke,
  };
}

const selectFriends = "select friend, amount_owed_cents, amount_status, inside_joke from ledger_friends where owner = $1 order by position";

/**
 * Create the Postgres ledger store for one owner's ledger.
 *
 * @param sql - The database; `replace` runs in a transaction.
 * @param owner - Whose ledger this is: the Seeded Ode's, or one judge's. Every query is under it.
 * @returns A store backed by the `ledger` and `ledger_friends` tables.
 */
export function createLedgerStore(sql: Sql, owner: Owner): LedgerStore {
  /** The saved ledger's trip name; `DEFAULT_TRIP` when there is no ledger. */
  async function readTrip(): Promise<string> {
    const { rows } = await sql.query<{ trip: string }>("select trip from ledger where owner = $1", [owner]);
    return rows[0]?.trip ?? DEFAULT_TRIP;
  }

  async function read(): Promise<StoredLedger> {
    const [meta, friends, trip] = await Promise.all([
      sql.query<{ notes: string; warnings: string[] }>("select notes, warnings from ledger where owner = $1", [owner]),
      sql.query<FriendRecord>(selectFriends, [owner]),
      readTrip(),
    ]);
    return {
      notes: meta.rows[0]?.notes ?? "",
      trip,
      warnings: meta.rows[0]?.warnings ?? [],
      rows: friends.rows.map(toRow),
    };
  }

  return {
    read,

    trip: readTrip,

    async replace(ledger) {
      await sql.transaction(async (tx) => {
        // Delete, then insert, so rows that reference the old ledger (the lyrics) cascade away.
        await tx.query("delete from ledger where owner = $1", [owner]);
        await tx.query("insert into ledger (owner, notes, trip, warnings) values ($1, $2, $3, $4::jsonb)", [
          owner,
          ledger.notes,
          ledger.trip,
          JSON.stringify(ledger.warnings),
        ]);
        for (const [position, row] of ledger.rows.entries()) {
          await tx.query(
            `insert into ledger_friends (owner, friend, position, amount_owed_cents, amount_status, inside_joke)
             values ($1, $2, $3, $4, $5, $6)`,
            [owner, row.friend, position, row.amountOwedCents, row.amountStatus, row.insideJoke],
          );
        }
      });
    },

    async updateRow(friend, fields) {
      const { rows } = await sql.query<FriendRecord>(
        `update ledger_friends set
           amount_owed_cents = coalesce($2::integer, amount_owed_cents),
           amount_status = coalesce($3::text, amount_status),
           inside_joke = coalesce($4::text, inside_joke)
         where owner = $5 and friend = $1
         returning friend, amount_owed_cents, amount_status, inside_joke`,
        [friend, fields.amountOwedCents ?? null, fields.amountStatus ?? null, fields.insideJoke ?? null, owner],
      );
      return rows[0] === undefined ? undefined : toRow(rows[0]);
    },

    async linkTokens() {
      const { rows } = await sql.query<{ friend: string; link_token: string }>("select friend, link_token from ledger_friends where owner = $1", [owner]);
      return new Map(rows.map((row) => [row.friend, row.link_token]));
    },
  };
}

/** A friend's private link, and whose Ode it is for. */
export interface LinkHolder {
  readonly owner: Owner;
  readonly friend: string;
}

/**
 * Find who a private link token belongs to, across every Ode's ledger.
 *
 * @param sql - The database.
 * @param token - Untrusted: the token from a link.
 * @returns The Ode and friend the token belongs to; undefined for a token nobody holds, including one from a replaced ledger.
 */
export async function findLinkHolder(sql: Sql, token: string): Promise<LinkHolder | undefined> {
  // A malformed token holds nobody, and a stray NUL byte would make the database refuse the query.
  if (!isTokenShaped(token)) return undefined;
  const { rows } = await sql.query<{ owner: string; friend: string }>("select owner, friend from ledger_friends where link_token = $1", [token]);
  const row = rows[0];
  if (row === undefined) return undefined;
  return { owner: ownerOfRow("ledger_friends", row.owner), friend: row.friend };
}
