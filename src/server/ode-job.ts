import { createLedgerStore } from "./ledger-store.ts";
import { createLyricsStore } from "./lyrics-store.ts";
import { runOdePipeline, type OdeRunOutcome } from "./ode-pipeline.ts";
import type { RunId } from "./ode-run.ts";
import { createOdeStore } from "./ode-store.ts";
import type { Claude, ElevenMusic, Sql } from "./ports.ts";

/** Makes the Ode for one run, wherever it runs: the Workflow task, the in-process Workflow, or a test. */
export type OdeJob = (run: RunId) => Promise<OdeRunOutcome>;

/**
 * Wire the song pipeline to Postgres and the two services it calls. The Workflow task builds this from its own
 * environment, so the pipeline never depends on the web service's connections.
 *
 * @param deps - The database, Claude and Eleven Music.
 * @returns The job that makes the Ode for a run.
 */
export function createOdeJob({ sql, claude, music }: { sql: Sql; claude: Claude; music: ElevenMusic }): OdeJob {
  const store = createOdeStore(sql);
  const pipeline = { claude, music, ledger: createLedgerStore(sql), lyrics: createLyricsStore(sql), odes: store, runs: store };
  return (run) => runOdePipeline(pipeline, run);
}
