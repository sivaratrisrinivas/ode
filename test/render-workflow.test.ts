import { describe, expect, it } from "vitest";
import { parseRunId } from "../src/server/ode-run.ts";
import { WorkflowUnavailable } from "../src/server/ports.ts";
import { createRenderWorkflow, MAKE_ODE_TASK, type RenderTasks } from "../src/server/render-workflow.ts";

const run = (() => {
  const parsed = parseRunId("3f2b8c1e-5a47-4d0b-9c6e-1a2b3c4d5e6f");
  if (parsed._tag === "err") throw parsed.error;
  return parsed.value;
})();

/** What Render's SDK would be asked, and what a test makes it answer. */
function fakeRender(overrides: Partial<RenderTasks> = {}) {
  const started: { slug: string; input: unknown[]; idempotencyKey: string }[] = [];
  const statuses = new Map<string, string>();
  const tasks: RenderTasks = {
    async startTask(slug, input, options) {
      started.push({ slug, input, idempotencyKey: options.idempotencyKey });
      return { taskRunId: "trn-abc123" };
    },
    async getTaskRun(id) {
      return { status: statuses.get(id) ?? "pending" };
    },
    ...overrides,
  };
  return { tasks, started, setStatus: (id: string, status: string) => statuses.set(id, status) };
}

describe("the Render Workflow adapter", () => {
  it("starts the make-ode task of the workflow for the run, and gives the Render task run as the Workflow's record", async () => {
    const render = fakeRender();
    const workflow = createRenderWorkflow({ tasks: render.tasks, workflowSlug: "ode-workflow" });

    const started = await workflow.start(run);

    expect(started).toEqual({ _tag: "ok", value: "trn-abc123" });
    // Starting the same run twice must not start two tasks, so the run is its own idempotency key.
    expect(render.started).toEqual([{ slug: `ode-workflow/${MAKE_ODE_TASK}`, input: [run], idempotencyKey: run }]);
  });

  it.each([
    ["pending", "active"],
    ["running", "active"],
    ["paused", "active"],
    ["completed", "completed"],
    ["succeeded", "completed"],
    ["failed", "failed"],
    ["canceled", "canceled"],
  ])("reports a Render task run that is %s as %s", async (renderStatus, expected) => {
    const render = fakeRender();
    const workflow = createRenderWorkflow({ tasks: render.tasks, workflowSlug: "ode-workflow" });
    const started = await workflow.start(run);
    if (started._tag === "err") throw started.error;
    render.setStatus(started.value, renderStatus);

    expect(await workflow.status(started.value)).toEqual({ _tag: "ok", value: expected });
  });

  it("says the Workflow is unavailable, rather than guessing, when Render rejects a start", async () => {
    const render = fakeRender({
      startTask: async () => {
        throw new Error("401 unauthorized");
      },
    });
    const workflow = createRenderWorkflow({ tasks: render.tasks, workflowSlug: "ode-workflow" });

    const started = await workflow.start(run);

    expect(started._tag).toBe("err");
    expect(started._tag === "err" && started.error).toBeInstanceOf(WorkflowUnavailable);
  });

  it("says the Workflow is unavailable when Render cannot report a run, or reports a status it does not know", async () => {
    const render = fakeRender();
    const workflow = createRenderWorkflow({ tasks: render.tasks, workflowSlug: "ode-workflow" });
    const started = await workflow.start(run);
    if (started._tag === "err") throw started.error;

    render.setStatus(started.value, "teleporting");
    const unknown = await workflow.status(started.value);
    const unreachable = await createRenderWorkflow({
      tasks: fakeRender({
        getTaskRun: async () => {
          throw new Error("503");
        },
      }).tasks,
      workflowSlug: "ode-workflow",
    }).status(started.value);

    expect(unknown._tag).toBe("err");
    expect(unreachable._tag).toBe("err");
    expect(unreachable._tag === "err" && unreachable.error).toBeInstanceOf(WorkflowUnavailable);
  });
});
