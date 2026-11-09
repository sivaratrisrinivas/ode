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
}
