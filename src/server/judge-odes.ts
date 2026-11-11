import type { Owner } from "./owner.ts";
import type { Clock, Queryable, Sql } from "./ports.ts";
import { err, ok, type Result } from "./result.ts";
import type { VisitorId } from "./visitor-id.ts";

/** How many new Odes judges may start making in a day, all visitors together: each one spends Eleven Music credits. */
export const DAILY_NEW_ODES = 5;

/** The day's new Odes are used up, so the visitor stays on the Seeded Ode. */
export class CapReached extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "CapReached" as const;

  /** Takes no arguments: the message says what the visitor gets instead, and when new Odes open again. */
  constructor() {
    super(`Today's ${DAILY_NEW_ODES} new Odes have all been made, so here is the Seeded Ode instead. New Odes open again tomorrow (UTC).`);
  }
}

/** A place in the day's cap, taken for one new Ode. */
export interface Claim {
  /** Give the place back, for an Ode that was never started: the counted song was never paid for. Giving back twice does nothing. */
  release(): Promise<void>;
}

/** The visitors who make their own Odes, and the day's count of new Odes. */
export interface JudgeOdes {
  /** Whether the visitor is making, or has made, their own Ode rather than looking at the Seeded Ode. */
  isJudge(visitor: VisitorId): Promise<boolean>;
  /**
   * Let the visitor start their own Ode. A visitor already on their own Ode stays on it, and nothing is counted: a new
   * Ode is counted when its song starts being made, not when it is begun.
   *
   * @returns `CapReached`, with nothing changed, when the day's new Odes are used up; a new Ode could not be made anyway.
   */
  enter(visitor: VisitorId): Promise<Result<void, CapReached>>;
  /**
   * Put the visitor back on the Seeded Ode, and forget their own Ode: its ledger, lyrics, song, payments and any run.
   * Odes already counted today stay counted. Does nothing for a visitor who is not on their own Ode.
   */
  leave(visitor: VisitorId): Promise<void>;
  /**
   * Count one new Ode made by `owner`, unless the day's are used up. All visitors share the count, and two requests at
   * once cannot both take the last place.
   *
   * @returns The place taken, to `release` if the Ode does not start after all; or `CapReached`, with nothing counted, when the
   *   day's new Odes are used up.
   */
  claim(owner: Owner): Promise<Result<Claim, CapReached>>;
}

/** The lock that makes counting a new Ode one step; any constant works, as nothing else takes advisory locks. */
const CLAIM_LOCK = 34;

/**
 * Create the judge registry and the day's cap, kept in Postgres so every web service process counts the same Odes.
 *
 * @param sql - The database.
 * @param clock - Says which day it is; the day is the UTC date, so the cap resets at 00:00 UTC.
 */
export function createJudgeOdes(sql: Sql, clock: Clock): JudgeOdes {
  const today = () => clock.now().toISOString().slice(0, 10);

  /** How many new Odes today's cap has already counted, read through `db` so a claim counts inside its own transaction. */
  async function claimedToday(db: Queryable): Promise<number> {
    const { rows } = await db.query<{ claimed: string }>("select count(*) as claimed from ode_claims where claimed_on = $1::date", [today()]);
    return Number(rows[0]?.claimed ?? 0);
  }

  async function isJudge(visitor: VisitorId): Promise<boolean> {
    const { rows } = await sql.query("select 1 from judge_odes where visitor = $1", [visitor]);
    return rows.length > 0;
  }

  return {
    isJudge,

    async enter(visitor) {
      if (await isJudge(visitor)) return ok(undefined);
      if ((await claimedToday(sql)) >= DAILY_NEW_ODES) return err(new CapReached());
      await sql.query("insert into judge_odes (visitor) values ($1) on conflict (visitor) do nothing", [visitor]);
      return ok(undefined);
    },

    async leave(visitor) {
      await sql.transaction(async (tx) => {
        // The ledger takes the lyrics, the song and the payments with it; the run and the orders do not cascade.
        await tx.query("delete from ledger where owner = $1", [visitor]);
        await tx.query("delete from ode_runs where owner = $1", [visitor]);
        await tx.query("delete from payment_orders where owner = $1", [visitor]);
        await tx.query("delete from judge_odes where visitor = $1", [visitor]);
      });
    },

    async claim(owner) {
      return sql.transaction<Result<Claim, CapReached>>(async (tx) => {
        await tx.query("select pg_advisory_xact_lock($1)", [CLAIM_LOCK]);
        if ((await claimedToday(tx)) >= DAILY_NEW_ODES) return err(new CapReached());
        const { rows } = await tx.query<{ id: string }>("insert into ode_claims (owner, claimed_on) values ($1, $2::date) returning id", [owner, today()]);
        const id = rows[0]?.id;
        // Defect: an insert with `returning` always returns its row.
        if (id === undefined) throw new Error("inserting an Ode claim returned no row");
        return ok({
          // Deleting by ID is idempotent: the second call finds nothing.
          async release() {
            await sql.query("delete from ode_claims where id = $1", [id]);
          },
        });
      });
    },
  };
}
