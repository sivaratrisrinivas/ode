import type { TaskContext } from "@renderinc/sdk/workflows";
import pg from "pg";
import { createAnthropicClaude } from "../server/claude.ts";
import { createElevenMusic } from "../server/eleven-music.ts";
import { createOdeJob } from "../server/ode-job.ts";
import type { OdeRunOutcome } from "../server/ode-pipeline.ts";
import { parseRunId } from "../server/ode-run.ts";
import { createPostgresSql } from "../server/postgres.ts";
import { Redacted } from "../server/redacted.ts";
import { parseTaskConfig } from "./task-config.ts";

/** What a finished run shows as its result in the Render dashboard. */
export interface MakeOdeResult {
  readonly outcome: OdeRunOutcome;
}

/**
 * One run of the song pipeline: lyrics, compose, line windows, store. The web service starts it with the ID of a
 * run it has already recorded in Postgres; this records each step there as it goes, which is how the web service
 * shows the status steps. `index.ts` registers it as the Workflow's `make-ode` task.
 *
 * A failure the pipeline can name is recorded and returned, not thrown. It throws only when it cannot start at all:
 * the run ID is not one, or the environment lacks the database URL or a key. Render then shows the run failed,
 * and the web service, seeing that, records the run as lost so the payer is told to try again.
 *
 * Nothing is read from the environment until a run starts.
 *
 * @param _ctx - Render's task context, unused: the pipeline chains no other runs.
 * @param runId - The run's ID, as the web service passed it; anything else is rejected.
 * @returns How the run ended.
 */
export async function makeOdeRun(_ctx: TaskContext, runId: unknown): Promise<MakeOdeResult> {
  const run = parseRunId(runId);
  if (run._tag === "err") throw run.error;
  const config = parseTaskConfig(process.env);
  if (config._tag === "err") throw config.error;

  // One run, one process: the pool lives exactly as long as the run.
  const pool = new pg.Pool({ connectionString: Redacted.reveal(config.value.databaseUrl) });
  pool.on("error", (error) => console.error("idle database connection failed:", error));
  try {
    const job = createOdeJob({
      sql: createPostgresSql(pool),
      claude: createAnthropicClaude(Redacted.reveal(config.value.anthropicApiKey)),
      music: createElevenMusic({ apiKey: Redacted.reveal(config.value.elevenLabsApiKey) }),
    });
    const outcome = await job(run.value);
    console.log(`run ${run.value} ended: ${outcome}`);
    return { outcome };
  } finally {
    await pool.end();
  }
}
