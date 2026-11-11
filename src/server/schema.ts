import { DEFAULT_TRIP } from "./ledger.ts";
import { ODE_FAILURE_TAGS } from "./ode-run.ts";
import { SEEDED } from "./owner.ts";
import type { Queryable, Sql } from "./ports.ts";

/** The `OdeFailure` tags a run row may hold, as a SQL list. */
const RUN_FAILURES = `(${ODE_FAILURE_TAGS.map((tag) => `'${tag}'`).join(", ")})`;

/** The default trip name as a SQL string literal. */
const DEFAULT_TRIP_SQL = `'${DEFAULT_TRIP.replaceAll("'", "''")}'`;

/** The tables of the version before judges could make their own Ode (#34): one ledger and one Ode, with no owner. */
const LEGACY_TABLES = [
  "ledger",
  "ledger_friends",
  "lyric_lines",
  "lyric_refrains",
  "odes",
  "ode_runs",
  "ode_sections",
  "ode_lines",
  "payments",
  "payment_orders",
] as const;

/**
 * Create every table in its current shape, if missing. Each Ode, the Seeded Ode's and each judge's, is a row set under its
 * `owner`; everything the Ode is made of cascades away with its ledger, so replacing a ledger removes what was made from it.
 */
async function createTables(sql: Queryable): Promise<void> {
  await sql.query(
    `create table if not exists ledger (
       owner text primary key,
       notes text not null,
       trip text not null default ${DEFAULT_TRIP_SQL},
       warnings jsonb not null default '[]'
     )`,
  );
  // Each friend's private link: two random UUIDs, 244 bits, so a link cannot be guessed.
  await sql.query(
    `create table if not exists ledger_friends (
       owner text not null references ledger (owner) on delete cascade,
       friend text not null,
       position integer not null,
       amount_owed_cents integer check (amount_owed_cents > 0),
       amount_status text not null check (amount_status in ('stated', 'estimated', 'missing', 'covered')),
       inside_joke text not null,
       link_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
       primary key (owner, friend)
     )`,
  );
  // Lyrics are written from the ledger and cascade away with it, so they can never describe friends who are no longer on it.
  await sql.query(
    `create table if not exists lyric_lines (
       owner text not null,
       friend text not null,
       line_no integer not null check (line_no between 1 and 4),
       text text not null check (char_length(text) <= 200),
       problems jsonb not null default '[]',
       primary key (owner, friend, line_no),
       foreign key (owner, friend) references ledger_friends (owner, friend) on delete cascade
     )`,
  );
  await sql.query(
    `create table if not exists lyric_refrains (
       owner text not null references ledger (owner) on delete cascade,
       kind text not null check (kind in ('hook', 'chorus')),
       text text not null check (char_length(text) <= 200),
       problems jsonb not null default '[]',
       primary key (owner, kind)
     )`,
  );
  // The Ode is made from the ledger and its lyrics and cascades away with the ledger, like the lyrics do. Its sections hold
  // their own text, so editing lyrics later never changes what was sung, and a verse can only be saved for a friend who is on
  // the ledger.
  await sql.query(
    `create table if not exists odes (
       owner text primary key references ledger (owner) on delete cascade,
       audio bytea not null,
       release_date text check (release_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
     )`,
  );
  // The run making the Ode, kept here because the Workflow task and the web service are different processes and both must see
  // it. One row per owner, replaced by the next attempt. It does not cascade away with the ledger: a run still going when the
  // ledger is replaced must still be able to say it failed. A run that saves the Ode deletes its row in the same commit; a
  // failed run keeps its row so the payer can be told. `failure` is null while the run is making. The Workflow task is given
  // only the run ID, and finds its owner here.
  await sql.query(
    `create table if not exists ode_runs (
       owner text primary key,
       run_id text not null unique,
       step text not null check (step in ('writing', 'composing', 'finding-lines')),
       started_at timestamptz not null,
       workflow_run_id text check (workflow_run_id <> ''),
       release_date text check (release_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
       failure text check (failure in
         ${RUN_FAILURES}),
       failure_message text,
       check (failure is not null or failure_message is null),
       check ((failure = 'LedgerNotReady') = (failure_message is not null) or failure is null)
     )`,
  );
  await sql.query(
    `create table if not exists ode_sections (
       owner text not null references odes (owner) on delete cascade,
       position integer not null,
       kind text not null check (kind in ('intro', 'verse', 'hook', 'chorus')),
       friend text,
       text text,
       start_ms integer not null,
       end_ms integer not null check (end_ms > start_ms),
       primary key (owner, position),
       foreign key (owner, friend) references ledger_friends (owner, friend) on delete cascade,
       check ((kind = 'verse') = (friend is not null)),
       check ((kind in ('hook', 'chorus')) = (text is not null))
     )`,
  );
  await sql.query(
    `create table if not exists ode_lines (
       owner text not null,
       position integer not null,
       line_no integer not null check (line_no between 1 and 4),
       text text not null,
       start_ms integer not null,
       end_ms integer not null check (end_ms > start_ms),
       primary key (owner, position, line_no),
       foreign key (owner, position) references ode_sections (owner, position) on delete cascade
     )`,
  );
  // Each captured payment, gross, keyed on PayPal's capture ID so the same capture is only ever counted once. A payment is to a
  // friend on an owner's ledger and cascades away with them when the ledger is replaced. `visitor` is whose copy it counts in:
  // each visitor's payments against the Seeded Ode are their own, and a judge's Ode counts only the judge's. `order_id` is the
  // order a capture belongs to, so a capture response that follows the webhook for the same order is known for what it is.
  await sql.query(
    `create table if not exists payments (
       capture_id text primary key,
       owner text not null default '${SEEDED}',
       friend text not null,
       amount_cents integer not null check (amount_cents > 0),
       captured_at timestamptz not null default now(),
       order_id text,
       visitor text,
       foreign key (owner, friend) references ledger_friends (owner, friend) on delete cascade
     )`,
  );
  await sql.query("create index if not exists payments_by_visitor on payments (visitor)");
  // The visitor and Ode each PayPal order was made for. Kept apart from `payments` because an order exists before its capture,
  // and PayPal's webhook carries no cookie: the order is how it finds the copy to count a payment in.
  await sql.query(
    `create table if not exists payment_orders (
       order_id text primary key,
       visitor text not null,
       owner text not null default '${SEEDED}'
     )`,
  );
  // A verse share is cut from the Ode when it is opened; this keeps only what the friend chose to put in it, under a link of its
  // own that says nothing about the friend's private page. It cascades away with the friend when the ledger is replaced.
  await sql.query(
    `create table if not exists verse_shares (
       token text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
       owner text not null,
       friend text not null,
       lines_unlocked integer not null check (lines_unlocked between 1 and 4),
       with_chorus boolean not null,
       unique (owner, friend, lines_unlocked, with_chorus),
       foreign key (owner, friend) references ledger_friends (owner, friend) on delete cascade
     )`,
  );
  // The visitors who are making their own Ode instead of looking at the Seeded Ode.
  await sql.query("create table if not exists judge_odes (visitor text primary key)");
  // Each new Ode a judge started making, for the day's cap. Kept after the judge's Ode goes, since its song was already paid for.
  await sql.query(
    `create table if not exists ode_claims (
       id bigserial primary key,
       owner text not null,
       claimed_on date not null
     )`,
  );
  await sql.query("create index if not exists ode_claims_by_day on ode_claims (claimed_on)");
}

/** Whether the database holds the tables of the version with one ledger and no owner. */
async function isLegacy(sql: Queryable): Promise<boolean> {
  const { rows } = await sql.query<{ has_owner: boolean; has_ledger: boolean }>(
    `select
       exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'ledger' and column_name = 'owner') as has_owner,
       exists (select 1 from information_schema.tables where table_schema = current_schema() and table_name = 'ledger') as has_ledger`,
  );
  return rows[0]?.has_ledger === true && rows[0].has_owner === false;
}

/**
 * Bring the one ledger and Ode of the version before judges' Odes in as the Seeded Ode: the old tables are set aside, the new
 * ones created, the rows copied under the owner `seeded` and the old tables dropped.
 */
async function adoptLegacy(tx: Queryable): Promise<void> {
  // What the deploys since the tables were first made added, so that a database which skipped them has what the copy reads.
  await tx.query(`alter table ledger add column if not exists trip text not null default ${DEFAULT_TRIP_SQL}`);
  await tx.query(
    `alter table ledger_friends add column if not exists link_token text not null unique
       default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`,
  );
  await tx.query("alter table ode_runs add column if not exists release_date text");
  await tx.query("alter table odes add column if not exists release_date text");
  await tx.query("alter table payments add column if not exists order_id text");
  await tx.query("alter table payments add column if not exists visitor text");
  await tx.query("create table if not exists payment_orders (order_id text primary key, visitor text not null)");

  for (const table of LEGACY_TABLES) await tx.query(`alter table ${table} rename to ${table}_v1`);
  await createTables(tx);
  const copies = [
    "insert into ledger (owner, notes, trip, warnings) select 'seeded', notes, trip, warnings from ledger_v1",
    `insert into ledger_friends (owner, friend, position, amount_owed_cents, amount_status, inside_joke, link_token)
       select 'seeded', friend, position, amount_owed_cents, amount_status, inside_joke, link_token from ledger_friends_v1`,
    "insert into lyric_lines (owner, friend, line_no, text, problems) select 'seeded', friend, line_no, text, problems from lyric_lines_v1",
    "insert into lyric_refrains (owner, kind, text, problems) select 'seeded', kind, text, problems from lyric_refrains_v1",
    "insert into odes (owner, audio, release_date) select 'seeded', audio, release_date from odes_v1",
    `insert into ode_sections (owner, position, kind, friend, text, start_ms, end_ms)
       select 'seeded', position, kind, friend, text, start_ms, end_ms from ode_sections_v1`,
    `insert into ode_lines (owner, position, line_no, text, start_ms, end_ms)
       select 'seeded', position, line_no, text, start_ms, end_ms from ode_lines_v1`,
    `insert into payments (capture_id, owner, friend, amount_cents, captured_at, order_id, visitor)
       select capture_id, 'seeded', friend, amount_cents, captured_at, order_id, visitor from payments_v1`,
    "insert into payment_orders (order_id, visitor, owner) select order_id, visitor, 'seeded' from payment_orders_v1",
    `insert into ode_runs (owner, run_id, step, started_at, workflow_run_id, release_date, failure, failure_message)
       select 'seeded', run_id, step, started_at, workflow_run_id, release_date, failure, failure_message from ode_runs_v1`,
  ];
  for (const copy of copies) await tx.query(copy);
  for (const table of [...LEGACY_TABLES].reverse()) await tx.query(`drop table ${table}_v1 cascade`);
}

/**
 * Creates tables if missing; idempotent, so it is safe on every boot. A database from before judges could make their own Ode
 * has its one ledger and Ode carried over as the Seeded Ode.
 */
export async function migrate(sql: Sql): Promise<void> {
  // The walking skeleton (#21) kept one hard-coded row here. #22 replaced it with the
  // tables below under new names, so dropping the old name is safe on every boot.
  await sql.query("drop table if exists ledger_rows");

  await sql.transaction(async (tx) => {
    if (await isLegacy(tx)) await adoptLegacy(tx);
    else await createTables(tx);
  });
}
