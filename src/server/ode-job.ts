import { createLedgerStore } from "./ledger-store.ts";
import { createLyricsStore } from "./lyrics-store.ts";
import { runOdePipeline, type OdeRunOutcome } from "./ode-pipeline.ts";
import type { RunId } from "./ode-run.ts";
import { createOdeStore, findRunOwner } from "./ode-store.ts";
import type { Claude, ElevenMusic, Sql } from "./ports.ts";

/** Makes the Ode for one run, wherever it runs: the Workflow task, the in-process Workflow, or a test. */
export type OdeJob = (run: RunId) => Promise<OdeRunOutcome>;

/**
 * Wire the song pipeline to Postgres and the two services it calls. The Workflow task builds this from its own
 * environment, so the pipeline never depends on the web service's connections. The job is given only the run's ID: the
 * run says whose Ode it is making.
 *
 * @param deps - The database, Claude and Eleven Music.
 * @returns The job that makes the Ode for a run; a run that is no longer kept (discarded, or replaced) is `superseded`.
 */
export function createOdeJob({ sql, claude, music }: { sql: Sql; claude: Claude; music: ElevenMusic }): OdeJob {
  return async (run) => {
    const owner = await findRunOwner(sql, run);
    if (owner === undefined) return "superseded";
    const store = createOdeStore(sql, owner);
    return runOdePipeline(
      { claude, music, ledger: createLedgerStore(sql, owner), lyrics: createLyricsStore(sql, owner), odes: store, runs: store },
      run,
    );
  };
}
