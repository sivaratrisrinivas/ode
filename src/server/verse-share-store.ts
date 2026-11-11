import { parseOwner } from "./owner.ts";
import type { Sql } from "./ports.ts";
import type { ShareRecord } from "./verse-share.ts";

/** What the schema generates for a share token: two UUIDs' hex digits. */
const SHARE_TOKEN = /^[0-9a-f]{64}$/;

/** Where verse shares are kept. */
export interface VerseShareStore {
  /**
   * Keep a share, or find the one already made with the same content, so a friend sharing twice gets the same link.
   *
   * @returns The share's token.
   */
  create(record: ShareRecord): Promise<string>;
  /** The share a token names; undefined for a token nobody holds, including one from a replaced ledger. */
  read(token: string): Promise<ShareRecord | undefined>;
}

/**
 * Create the Postgres verse share store.
 *
 * @param sql - The database.
 * @returns A store backed by the `verse_shares` table.
 */
export function createVerseShareStore(sql: Sql): VerseShareStore {
  return {
    async create({ owner, friend, linesUnlocked, withChorus }) {
      // The no-op update makes a repeated share return its row.
      const { rows } = await sql.query<{ token: string }>(
        `insert into verse_shares (owner, friend, lines_unlocked, with_chorus) values ($1, $2, $3, $4)
         on conflict (owner, friend, lines_unlocked, with_chorus) do update set friend = excluded.friend
         returning token`,
        [owner, friend, linesUnlocked, withChorus],
      );
      const row = rows[0];
      // Defect: an insert with a conflict clause always returns its row.
      if (row === undefined) throw new Error("inserting a verse share returned no row");
      return row.token;
    },

    async read(token) {
      // A malformed token holds nothing, and a stray NUL byte would make the database refuse the query.
      if (!SHARE_TOKEN.test(token)) return undefined;
      const { rows } = await sql.query<{ owner: string; friend: string; lines_unlocked: number; with_chorus: boolean }>(
        "select owner, friend, lines_unlocked, with_chorus from verse_shares where token = $1",
        [token],
      );
      const row = rows[0];
      if (row === undefined) return undefined;
      const owner = parseOwner(row.owner);
      // Defect: only this store writes owner, and it writes an Owner.
      if (owner._tag === "err") throw new Error(`corrupt verse_shares row: ${row.owner} is not an owner`);
      return { owner: owner.value, friend: row.friend, linesUnlocked: row.lines_unlocked, withChorus: row.with_chorus };
    },
  };
}
