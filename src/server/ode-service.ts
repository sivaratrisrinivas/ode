import type { CapReached, Claim } from "./judge-odes.ts";
import type { LedgerStore } from "./ledger-service.ts";
import { lyricFriends, requireUnflagged, type LedgerNotReady, type LyricsFlagged } from "./lyrics.ts";
import type { LyricsStore } from "./lyrics-service.ts";
import type { Ode } from "./ode.ts";
import type { MakingRun, OdeFailure, OdeRun, OdeStep, RunId, WorkflowRunId } from "./ode-run.ts";
import type { Clock, OdeWorkflow, WorkflowUnavailable } from "./ports.ts";
import { parseReleaseDate, type InvalidReleaseDate, type ReleaseDate } from "./release-date.ts";
import { err, ok, type Result } from "./result.ts";

/** What the Ode service needs from storage for the one Ode. */
export interface OdeStore {
  /** The saved Ode; undefined until one has been made for the current ledger. */
  read(): Promise<Ode | undefined>;
  /** The release date saved with the Ode; undefined when there is no Ode or it was made without one. It never changes. */
  releaseDate(): Promise<ReleaseDate | undefined>;
  /** The saved Ode's audio; undefined when there is no Ode. */
  readAudio(): Promise<Uint8Array | undefined>;
  /**
   * Save the Ode and its audio together, all or nothing, in place of any current Ode, and clear the run
   * in the same commit.
   *
   * @returns False, with nothing saved, when `run` is no longer the run in progress.
   */
  save(run: RunId, ode: Ode, audio: Uint8Array): Promise<boolean>;
}

/**
 * What the Ode service and the Workflow task need from storage for the one run. The task and the web service
 * are different processes, so this is where they meet: every method states what happens when `run` is no longer
 * the run in progress, so a stale process can never change the current run.
 */
export interface OdeRuns {
  /** The run in progress or the one that failed; undefined when none is kept. */
  current(): Promise<OdeRun | undefined>;
  /**
   * Record a new run at the first step, replacing a failed one, with the release date the payer promised (if any), which
   * the saved Ode keeps.
   *
   * @returns False, with nothing changed, when an Ode is already saved or a run is already in progress.
   */
  begin(run: RunId, startedAt: Date, releaseDate: ReleaseDate | undefined): Promise<boolean>;
  /** Record the Workflow's own ID for a run in progress. Does nothing when `run` is not in progress. */
  attach(run: RunId, workflowRun: WorkflowRunId): Promise<void>;
  /**
   * Move a run in progress to the next step.
   *
   * @returns False, with nothing changed, when `run` is not in progress.
   */
  advance(run: RunId, step: OdeStep): Promise<boolean>;
  /**
   * Record that a run in progress ended without an Ode.
   *
   * @returns False, with nothing changed, when `run` is not in progress.
   */
  fail(run: RunId, failure: OdeFailure): Promise<boolean>;
  /** Forget a run in progress, as if it had never begun. Does nothing when `run` is not in progress. */
  discard(run: RunId): Promise<void>;
}

/** An Ode is already saved, and making a new one is out of scope. */
export class OdeAlreadyMade extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "OdeAlreadyMade" as const;

  /** Takes no arguments: the message tells the payer how to start over. */
  constructor() {
    super("The Ode is already made. Build the ledger again to start over.");
  }
}

/** Why a run could not be started. */
export type StartOdeError = LedgerNotReady | LyricsFlagged | InvalidReleaseDate | OdeAlreadyMade | CapReached | WorkflowUnavailable;

/** The run in progress. */
export interface MakingOde {
  readonly _tag: "Making";
  readonly step: OdeStep;
}

/** Where the Ode stands: not made, being made, failed (nothing saved), or ready to play. */
export type OdeStatus =
  | { readonly _tag: "NotMade" }
  | MakingOde
  | { readonly _tag: "Failed"; readonly failure: OdeFailure }
  | { readonly _tag: "Ready"; readonly ode: Ode; readonly releaseDate: ReleaseDate | undefined };

/** Starts the pipeline that makes the Ode in the Workflow, and reports how far it got. */
export interface OdeMaker {
  /**
   * Start making the Ode. A run already in progress is not started twice, by this web service process or any other.
   *
   * @param releaseDate - The date the payer promises the whole Ode will drop, as sent: undefined for none, otherwise it must
   *   be a date today or later. It is judged only once no Ode exists and no run is in progress, and it is fixed from then on.
   * @returns The status after the request: the run just started or already in progress, or why none could start.
   */
  start(releaseDate: unknown): Promise<Result<OdeStatus, StartOdeError>>;
  /**
   * The current status, for the payer to poll. A run the Workflow has ended without saving an Ode is recorded as lost
   * here, so a run that died never leaves the payer waiting.
   */
  status(): Promise<OdeStatus>;
}

/**
 * How long a run may wait for the Workflow to accept it. Starting takes one request, so a run still
 * without a Workflow record after this was cut off by the web service dying between recording and starting.
 */
const START_GRACE_MS = 30_000;

/**
 * The longest a run may be in progress. The Workflow task times out after five minutes, so a run still going after
 * ten has been lost whatever the Workflow says, or cannot say: a revoked API key or a run Render no longer knows
 * must not keep the payer waiting for ever.
 */
const MAX_RUN_MS = 10 * 60_000;

/**
 * Create the Ode maker. It keeps no state of its own: the run lives in the database and the Workflow, so any
 * web service process can start the run, poll it, or pick it up after a restart.
 *
 * @param deps - The clock, the ledger, the lyrics, the Ode and run stores, the Workflow, and how run IDs are chosen. `admit`, when
 *   given, is asked before a new Ode starts being made (not before a retry of a failed run, which has already been admitted) and
 *   may refuse it; the place it grants is given back when the run does not begin or the Workflow does not start it, so a
 *   request that loses a race, or a start that fails and is tried again, costs one place in all.
 */
export function createOdeMaker(deps: {
  clock: Clock;
  ledger: Pick<LedgerStore, "read">;
  lyrics: Pick<LyricsStore, "read">;
  odes: Pick<OdeStore, "read" | "releaseDate">;
  runs: OdeRuns;
  workflow: OdeWorkflow;
  newRunId: () => RunId;
  admit?: () => Promise<Result<Claim, CapReached>>;
}): OdeMaker {
  /** The run is read before the Ode: a run saves the Ode and clears itself in one commit, so a run seen as gone already has its Ode. */
  async function observe() {
    const run = await deps.runs.current();
    const ode = await deps.odes.read();
    // Fixed when the Ode is saved, so reading it after the Ode cannot see a different date.
    return { run, ode, releaseDate: ode === undefined ? undefined : await deps.odes.releaseDate() };
  }

  function toStatus({ run, ode, releaseDate }: Awaited<ReturnType<typeof observe>>): OdeStatus {
    if (ode !== undefined) return { _tag: "Ready", ode, releaseDate };
    if (run === undefined) return { _tag: "NotMade" };
    return run._tag === "Making" ? { _tag: "Making", step: run.step } : { _tag: "Failed", failure: run.failure };
  }

  /** Whether a run in progress can no longer finish: the Workflow says it ended, or it never reached the Workflow. */
  async function hasEnded(run: MakingRun): Promise<boolean> {
    const age = deps.clock.now().getTime() - run.startedAt.getTime();
    if (age > MAX_RUN_MS) {
      console.error(`run ${run.run} has been in progress for ${Math.round(age / 1000)} s; recording it as lost`);
      return true;
    }
    if (run.workflowRun === undefined) return age > START_GRACE_MS;

    const state = await deps.workflow.status(run.workflowRun);
    if (state._tag === "err") {
      // The Workflow cannot say, so the run may still be going: keep showing it, until it is too old to be.
      console.error(`could not ask the Workflow about run ${run.run}:`, state.error);
      return false;
    }
    if (state.value === "active") return false;
    console.error(`the Workflow run for ${run.run} ended as ${state.value} without saving the Ode`);
    return true;
  }

  async function status(): Promise<OdeStatus> {
    const seen = await observe();
    if (seen.ode === undefined && seen.run?._tag === "Making" && (await hasEnded(seen.run))) {
      // Conditional on the run still being in progress, so a run that saved its Ode just now is not marked lost.
      await deps.runs.fail(seen.run.run, { _tag: "OdeRunLost" });
      return toStatus(await observe());
    }
    return toStatus(seen);
  }

  async function start(releaseDate: unknown): Promise<Result<OdeStatus, StartOdeError>> {
    const friends = lyricFriends(await deps.ledger.read());
    if (friends._tag === "err") return err(friends.error);
    // An Ode already made, or a run in progress, is answered as before whatever the lyrics now say.
    const seen = await status();
    if (seen._tag === "Ready") return err(new OdeAlreadyMade());
    if (seen._tag === "Making") return ok(seen);

    // Only now is the release date judged: an Ode or run that exists is answered whatever date this request carries.
    const date = releaseDate === undefined ? undefined : parseReleaseDate(releaseDate, deps.clock.now());
    if (date?._tag === "err") return err(date.error);

    // Saved lyrics with a flagged line are refused here. With none saved, the run writes them and checks them itself.
    const saved = await deps.lyrics.read();
    const unflagged = saved === undefined ? undefined : requireUnflagged(saved);
    if (unflagged?._tag === "err") return err(unflagged.error);

    // A retry of a failed run was admitted when that run started; anything else is a new Ode, and may have to wait for tomorrow.
    let place: Claim | undefined;
    if (seen._tag !== "Failed" && deps.admit !== undefined) {
      const admitted = await deps.admit();
      if (admitted._tag === "err") return err(admitted.error);
      place = admitted.value;
    }

    // One statement checks that there is no Ode and no run in progress, and records this run, so two requests (or a
    // request and a run that is just saving) cannot both start a paid song.
    const run = deps.newRunId();
    if (!(await deps.runs.begin(run, deps.clock.now(), date?.value))) {
      // Another request began the run (and was admitted for it), so this one's place is spare.
      await place?.release();
      const current = await status();
      return current._tag === "Ready" ? err(new OdeAlreadyMade()) : ok(current);
    }

    const started = await deps.workflow.start(run);
    if (started._tag === "err") {
      await deps.runs.discard(run);
      // The discarded run is gone, so trying again is admitted afresh: this attempt's place goes back or it would be counted twice.
      await place?.release();
      return err(started.error);
    }
    await deps.runs.attach(run, started.value);
    return ok({ _tag: "Making", step: "writing" });
  }

  return { start, status };
}
