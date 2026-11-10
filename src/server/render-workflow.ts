import { parseWorkflowRunId, type RunId } from "./ode-run.ts";
import { WorkflowUnavailable, type OdeWorkflow, type WorkflowRunState } from "./ports.ts";
import { err, ok, type Result } from "./result.ts";

/** The name the song pipeline's task registers under in the Render Workflow; its slug is `{workflow slug}/make-ode`. */
export const MAKE_ODE_TASK = "make-ode";

/**
 * The part of the Render SDK's `render.workflows` client this adapter uses, so tests can stand in for Render.
 * The SDK's own client satisfies it as it is.
 */
export interface RenderTasks {
  /** Start a task run; with the same `idempotencyKey` Render returns the run already started instead of a second. */
  startTask(slug: string, input: unknown[], options: { idempotencyKey: string }): Promise<{ taskRunId: string }>;
  /** Read a task run's details; `status` is Render's own word for where it is. */
  getTaskRun(taskRunId: string): Promise<{ status: string }>;
}

/** Render's task run statuses, as the Render API documents them, in the terms this application needs. */
function parseRunState(status: string): Result<WorkflowRunState, WorkflowUnavailable> {
  switch (status) {
    case "pending":
    case "running":
    case "paused":
      return ok("active");
    // The API lists both: `completed` is the older word for `succeeded`.
    case "completed":
    case "succeeded":
      return ok("completed");
    case "failed":
      return ok("failed");
    case "canceled":
      return ok("canceled");
    default:
      // Not guessed at: a status this code does not know could be a run still going.
      return err(new WorkflowUnavailable(`unknown task run status: ${status}`));
  }
}

/**
 * The production Workflow: the song pipeline runs as a task of a Render Workflow, which this
 * starts and polls through Render's API. Every Render error is translated here, so callers see only `WorkflowUnavailable`.
 *
 * @param deps - Render's tasks client, and the slug of the workflow service the task is registered in.
 */
export function createRenderWorkflow({ tasks, workflowSlug }: { tasks: RenderTasks; workflowSlug: string }): OdeWorkflow {
  return {
    async start(run: RunId) {
      try {
        // The run is its own idempotency key, so a retried request cannot start the pipeline, and spend a song, twice.
        const started = await tasks.startTask(`${workflowSlug}/${MAKE_ODE_TASK}`, [run], { idempotencyKey: run });
        const id = parseWorkflowRunId(started.taskRunId);
        return id._tag === "ok" ? id : err(new WorkflowUnavailable(id.error));
      } catch (cause) {
        return err(new WorkflowUnavailable(cause));
      }
    },

    async status(run) {
      try {
        return parseRunState((await tasks.getTaskRun(run)).status);
      } catch (cause) {
        return err(new WorkflowUnavailable(cause));
      }
    },
  };
}
