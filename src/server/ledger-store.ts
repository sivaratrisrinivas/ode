import { DEFAULT_TRIP, type AmountStatus, type LedgerRow } from "./ledger.ts";
import type { LedgerStore, StoredLedger } from "./ledger-service.ts";
import type { Sql } from "./ports.ts";

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

/** What the schema generates for a link token: two UUIDs' hex digits. */
const LINK_TOKEN = /^[0-9a-f]{64}$/;

const selectFriends = "select friend, amount_owed_cents, amount_status, inside_joke from ledger_friends order by position";

/**
 * Create the Postgres ledger store.
 *
 * @param sql - The database; `replace` runs in a transaction.
 * @returns A store backed by the `ledger` and `ledger_friends` tables.
 */
export function createLedgerStore(sql: Sql): LedgerStore {
  /** The saved ledger's trip name; `DEFAULT_TRIP` when there is no ledger. */
  async function readTrip(): Promise<string> {
    const { rows } = await sql.query<{ trip: string }>("select trip from ledger where id = 1");
    return rows[0]?.trip ?? DEFAULT_TRIP;
  }

  async function read(): Promise<StoredLedger> {
    const [meta, friends, trip] = await Promise.all([
      sql.query<{ notes: string; warnings: string[] }>("select notes, warnings from ledger where id = 1"),
      sql.query<FriendRecord>(selectFriends),
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
        await tx.query("delete from ledger_friends");
        await tx.query("delete from ledger");
        await tx.query("insert into ledger (id, notes, trip, warnings) values (1, $1, $2, $3::jsonb)", [
          ledger.notes,
          ledger.trip,
          JSON.stringify(ledger.warnings),
        ]);
        for (const [position, row] of ledger.rows.entries()) {
          await tx.query(
            `insert into ledger_friends (friend, position, amount_owed_cents, amount_status, inside_joke)
             values ($1, $2, $3, $4, $5)`,
            [row.friend, position, row.amountOwedCents, row.amountStatus, row.insideJoke],
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
         where friend = $1
         returning friend, amount_owed_cents, amount_status, inside_joke`,
        [friend, fields.amountOwedCents ?? null, fields.amountStatus ?? null, fields.insideJoke ?? null],
      );
      return rows[0] === undefined ? undefined : toRow(rows[0]);
    },

    async linkTokens() {
      const { rows } = await sql.query<{ friend: string; link_token: string }>("select friend, link_token from ledger_friends");
      return new Map(rows.map((row) => [row.friend, row.link_token]));
    },

    async friendForToken(token) {
      // A malformed token holds nobody, and a stray NUL byte would make the database refuse the query.
      if (!LINK_TOKEN.test(token)) return undefined;
      const { rows } = await sql.query<{ friend: string }>("select friend from ledger_friends where link_token = $1", [token]);
      return rows[0]?.friend;
    },
  };
}
