import type { Sql } from "./ports.ts";

/** Creates tables if missing; idempotent, so it is safe on every boot. */
export async function migrate(sql: Sql): Promise<void> {
  // The walking skeleton (#21) kept one hard-coded row here. #22 replaced it with the
  // tables below under new names, so dropping the old name is safe on every boot.
  await sql.query("drop table if exists ledger_rows");

  await sql.query(
    `create table if not exists ledger (
       id integer primary key check (id = 1),
       notes text not null,
       warnings jsonb not null default '[]'
     )`,
  );
  await sql.query(
    `create table if not exists ledger_friends (
       friend text primary key,
       position integer not null,
       amount_owed_cents integer check (amount_owed_cents > 0),
       amount_status text not null check (amount_status in ('stated', 'estimated', 'missing', 'covered')),
       inside_joke text not null
     )`,
  );
  // Lyrics are written from the ledger and cascade away with it: replacing the ledger (delete, then
  // insert) deletes the lyrics, so they can never describe friends who are no longer on it.
  await sql.query(
    `create table if not exists lyric_lines (
       friend text not null references ledger_friends (friend) on delete cascade,
       line_no integer not null check (line_no between 1 and 4),
       text text not null check (char_length(text) <= 200),
       problems jsonb not null default '[]',
       primary key (friend, line_no)
     )`,
  );
  await sql.query(
    `create table if not exists lyric_refrains (
       kind text primary key check (kind in ('hook', 'chorus')),
       ledger_id integer not null default 1 references ledger (id) on delete cascade,
       text text not null check (char_length(text) <= 200),
       problems jsonb not null default '[]'
     )`,
  );
  // The Ode is made from the ledger and its lyrics and cascades away with the ledger, like the lyrics do.
  // Its sections hold their own text, so editing lyrics later never changes what was sung, and a verse can
  // only be saved for a friend who is on the ledger.
  await sql.query(
    `create table if not exists odes (
       id integer primary key check (id = 1),
       ledger_id integer not null default 1 references ledger (id) on delete cascade,
       audio bytea not null
     )`,
  );
  await sql.query(
    `create table if not exists ode_sections (
       position integer primary key,
       ode_id integer not null default 1 references odes (id) on delete cascade,
       kind text not null check (kind in ('intro', 'verse', 'hook', 'chorus')),
       friend text references ledger_friends (friend) on delete cascade,
       text text,
       start_ms integer not null,
       end_ms integer not null check (end_ms > start_ms),
       check ((kind = 'verse') = (friend is not null)),
       check ((kind in ('hook', 'chorus')) = (text is not null))
     )`,
  );
  await sql.query(
    `create table if not exists ode_lines (
       position integer not null references ode_sections (position) on delete cascade,
       line_no integer not null check (line_no between 1 and 4),
       text text not null,
       start_ms integer not null,
       end_ms integer not null check (end_ms > start_ms),
       primary key (position, line_no)
     )`,
  );
}
