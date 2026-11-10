import { Redacted } from "./redacted.ts";
import { err, ok, type Result } from "./result.ts";

/** Where the Ode is made: in a Render Workflow task, reached with this key and slug, or inside the web service process. */
export type WorkflowChoice =
  | { readonly _tag: "Render"; readonly apiKey: Redacted<string>; readonly workflowSlug: string }
  | { readonly _tag: "InProcess" };

/** The environment names the Render Workflow but not completely, or not at all where it must. */
export class WorkflowNotConfigured extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "WorkflowNotConfigured" as const;

  /** The names of the variables that are missing or empty; never their values. */
  readonly missing: readonly string[];

  /** @param missing - The names of the variables that are missing or empty; never their values. */
  constructor(missing: readonly string[]) {
    super(`The Ode cannot run as a Render Workflow task: set ${missing.join(" and ")}.`);
    this.missing = missing;
  }
}

/**
 * Choose where the Ode is made from the web service's environment. On Render the Ode must be made by the
 * Workflow, so missing settings are an error and never a quiet fallback to the web service process;
 * off Render, with neither setting, the job runs in process so the app works without a Render account.
 *
 * @param env - The process environment: `RENDER_API_KEY`, `ODE_WORKFLOW_SLUG` and Render's own `RENDER`.
 * @returns Where to run the job, or `WorkflowNotConfigured` naming what is missing.
 */
export function parseWorkflowConfig(env: Readonly<Record<string, string | undefined>>): Result<WorkflowChoice, WorkflowNotConfigured> {
  const apiKey = env["RENDER_API_KEY"];
  const workflowSlug = env["ODE_WORKFLOW_SLUG"];
  if (apiKey && workflowSlug) return ok({ _tag: "Render", apiKey: new Redacted(apiKey), workflowSlug });

  const onRender = env["RENDER"] === "true";
  // Setting one of the two says the Workflow was meant; so does being on Render.
  if (!onRender && !apiKey && !workflowSlug) return ok({ _tag: "InProcess" });
  return err(new WorkflowNotConfigured([...(apiKey ? [] : ["RENDER_API_KEY"]), ...(workflowSlug ? [] : ["ODE_WORKFLOW_SLUG"])]));
}
