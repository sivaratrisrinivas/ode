import type { Sql } from "./ports.ts";

/** Creates tables if missing; idempotent, so it is safe on every boot. */
export async function migrate(sql: Sql): Promise<void> {
  await sql.query(
    `create table if not exists ledger_rows (
       friend text primary key,
       amount_owed_cents integer not null check (amount_owed_cents > 0),
       inside_joke text not null
     )`,
  );
}

/** The skeleton's hard-coded ledger row (#21); #22 replaces it with real ledgers. Idempotent. */
export async function seedSkeletonLedger(sql: Sql): Promise<void> {
  await sql.query(
    `insert into ledger_rows (friend, amount_owed_cents, inside_joke)
     values ('Tharun', 9750, 'Drove the overnight stretch to Key West while everyone slept')
     on conflict (friend) do nothing`,
  );
}
