import { err, ok, type Result } from "./result.ts";

/** The steps of making the Ode, in the order they run. */
export const ODE_STEPS = ["writing", "composing", "finding-lines"] as const;

/** Where a run is: the lyrics are being written (or read), the song composed, or the line windows found and saved. */
export type OdeStep = (typeof ODE_STEPS)[number];

/** Names a value of type `T` that only a parser can produce. */
type Brand<T, Name extends string> = T & { readonly __brand: Name };

/** Identifies one attempt to make the Ode; chosen by the web service, carried to the Workflow task, and kept with the progress. */
export type RunId = Brand<string, "RunId">;

/** Identifies the Workflow's own record of a run (a Render task run ID); never the same as a `RunId`. */
export type WorkflowRunId = Brand<string, "WorkflowRunId">;

/** The text is not a run ID. */
export class InvalidRunId extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "InvalidRunId" as const;

  /** Takes no arguments: the message says what a run ID looks like. */
  constructor() {
    super("A run ID is a UUID");
  }
}

/** The text is not a Workflow run ID. */
export class InvalidWorkflowRunId extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "InvalidWorkflowRunId" as const;

  /** Takes no arguments: the message says what is wrong. */
  constructor() {
    super("A Workflow run ID is not empty");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Parse a run ID from the Workflow task's input or a stored row.
 *
 * @param input - Anything; only a lower-case UUID string is a run ID.
 * @returns The run ID, or `InvalidRunId`.
 */
export function parseRunId(input: unknown): Result<RunId, InvalidRunId> {
  if (typeof input !== "string" || !UUID.test(input)) return err(new InvalidRunId());
  // SAFETY: TypeScript cannot express the brand. The check above is the only way to get here, and callers cannot build a RunId otherwise.
  return ok(input as RunId);
}

/**
 * Parse the Workflow's ID for a run, as the Workflow reports it or as stored.
 *
 * @param input - The Workflow's identifier for the run.
 * @returns The Workflow run ID, or `InvalidWorkflowRunId` when it is empty.
 */
export function parseWorkflowRunId(input: string): Result<WorkflowRunId, InvalidWorkflowRunId> {
  if (input === "") return err(new InvalidWorkflowRunId());
  // SAFETY: TypeScript cannot express the brand. The check above is the only way to get here, and callers cannot build a WorkflowRunId otherwise.
  return ok(input as WorkflowRunId);
}

/**
 * Every reason a run can end without an Ode. The one list: the `OdeFailure` type and the database's check on
 * stored failures are both built from it, so a new reason is added here and the compiler finds the rest.
 *
 * `LyricsFlagged`: the lyrics the run used still have a flagged line.
 * `OdeRunCrashed`: something unexpected, not a known failure, stopped the run.
 * `OdeRunLost`: the run ended, or never reached the Workflow, without saying so.
 */
export const ODE_FAILURE_TAGS = [
  "LedgerNotReady",
  "ClaudeUnavailable",
  "MalformedLyrics",
  "MusicUnavailable",
  "LyricsFlagged",
  "OdeRunCrashed",
  "OdeRunLost",
] as const;

/**
 * Why a run ended without an Ode, as recorded so that any web service process can tell the payer.
 * Only `LedgerNotReady` carries text for the payer: it names what to fix on the ledger.
 */
export type OdeFailure =
  | { readonly _tag: "LedgerNotReady"; readonly message: string }
  | { readonly _tag: Exclude<(typeof ODE_FAILURE_TAGS)[number], "LedgerNotReady"> };

/** The run in progress, as stored. */
export interface MakingRun {
  readonly _tag: "Making";
  readonly run: RunId;
  readonly step: OdeStep;
  readonly startedAt: Date;
  /** The Workflow's record of the run; undefined until the Workflow has accepted the start. */
  readonly workflowRun: WorkflowRunId | undefined;
}

/** A run that ended without an Ode. */
export interface FailedRun {
  readonly _tag: "Failed";
  readonly run: RunId;
  readonly failure: OdeFailure;
}

/** The latest attempt to make the Ode that has not produced one. A run that produced the Ode is not kept. */
export type OdeRun = MakingRun | FailedRun;
