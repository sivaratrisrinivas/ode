import type { OdeJob } from "./ode-job.ts";
import { parseWorkflowRunId, type WorkflowRunId } from "./ode-run.ts";
import { WorkflowUnavailable, type OdeWorkflow, type WorkflowRunState } from "./ports.ts";
import { err, ok } from "./result.ts";

/**
 * A Workflow that runs the job inside this process, for development without Render. It is the same job the
 * Render task runs, so the status steps work the same; what it lacks is a separate machine, so a restart of
 * this process loses a run in progress, and the web service then records the run as lost.
 *
 * @param job - Makes the Ode for a run.
 */
export function createInProcessWorkflow(job: OdeJob): OdeWorkflow {
  const states = new Map<WorkflowRunId, WorkflowRunState>();

  return {
    async start(run) {
      // The run's own ID, so starting it again finds the run already going instead of starting a second.
      const id = parseWorkflowRunId(`local-${run}`);
      if (id._tag === "err") return err(new WorkflowUnavailable(id.error));
      if (states.has(id.value)) return ok(id.value);

      states.set(id.value, "active");
      void job(run).then(
        () => states.set(id.value, "completed"),
        (cause: unknown) => {
          console.error("the in-process Workflow run failed:", cause);
          states.set(id.value, "failed");
        },
      );
      return ok(id.value);
    },

    async status(run) {
      // A run this process does not know was started before it restarted, so it can no longer be going.
      return ok(states.get(run) ?? "failed");
    },
  };
}
