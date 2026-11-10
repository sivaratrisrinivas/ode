import type { LedgerStore } from "./ledger-service.ts";
import { writeLyrics, type LyricsStore, type WriteLyricsError } from "./lyrics-service.ts";
import { requireUnflagged, type LyricsFlagged } from "./lyrics.ts";
import { buildOde, planOde } from "./ode.ts";
import type { OdeFailure, RunId } from "./ode-run.ts";
import type { OdeRuns, OdeStore } from "./ode-service.ts";
import type { Claude, ElevenMusic, MusicUnavailable } from "./ports.ts";
import { err, ok, type Result } from "./result.ts";

/** Something unexpected, not a known failure, stopped a run. */
export class OdeRunCrashed extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "OdeRunCrashed" as const;

  /** @param cause - The unexpected error, kept for the operator's log. */
  constructor(cause: unknown) {
    super("Making the Ode stopped unexpectedly", { cause });
  }
}

/** Why a run that started did not produce an Ode. */
export type MakeOdeError = WriteLyricsError | LyricsFlagged | MusicUnavailable | OdeRunCrashed;

/**
 * How a run ended: the Ode is saved, the run failed and said so, or it was no longer the run in
 * progress (the web service had given up on it) and so changed nothing.
 */
export type OdeRunOutcome = "ready" | "failed" | "superseded";

/** What the pipeline needs: Claude and Eleven Music, and storage for the ledger, lyrics, Ode and run. */
export interface OdePipelineDeps {
  claude: Claude;
  music: ElevenMusic;
  ledger: Pick<LedgerStore, "read">;
  lyrics: LyricsStore;
  odes: Pick<OdeStore, "save">;
  runs: Pick<OdeRuns, "advance" | "fail">;
}

/** What the payer is told about a run that failed, from the error that stopped it. */
function failureOf(error: MakeOdeError): OdeFailure {
  return error._tag === "LedgerNotReady" ? { _tag: "LedgerNotReady", message: error.message } : { _tag: error._tag };
}

/** Write the lyrics when none are saved, compose, find the line windows, then save. Nothing is saved before the end. */
async function produce(deps: OdePipelineDeps, run: RunId): Promise<Result<"ready" | "superseded", MakeOdeError>> {
  // A run the web service has already given up on (the Workflow was slow to start it) must not spend lyrics or a song.
  if (!(await deps.runs.advance(run, "writing"))) return ok("superseded");
  const saved = await deps.lyrics.read();
  const lyrics =
    saved !== undefined ? ok(saved) : await writeLyrics({ claude: deps.claude, ledger: deps.ledger, store: deps.lyrics });
  if (lyrics._tag === "err") return err(lyrics.error);
  // Flagged lines are not sung. The lyrics stay saved, flags and all, so the payer can fix them in the preview.
  const unflagged = requireUnflagged(lyrics.value);
  if (unflagged._tag === "err") return err(unflagged.error);

  // Each step is recorded before its work starts, and a run the web service has given up on stops before spending a song.
  if (!(await deps.runs.advance(run, "composing"))) return ok("superseded");
  const plan = planOde(lyrics.value);
  const song = await deps.music.compose(plan.chunks);
  if (song._tag === "err") return err(song.error);

  if (!(await deps.runs.advance(run, "finding-lines"))) return ok("superseded");
  const { ode, unaligned } = buildOde(plan, song.value.words);
  for (const verse of unaligned) console.warn(`${verse.friend}'s verse falls back to equal quarters:`, verse.reason.message);
  return ok((await deps.odes.save(run, ode, song.value.audio)) ? "ready" : "superseded");
}

/**
 * Make the Ode for `run`: lyrics, compose, line windows, store. This is the body of the Workflow task.
 * Progress and failure are recorded in the database as it goes, which is how the web service shows the steps.
 * Nothing is saved when it fails. A failure, expected or not, is recorded and returned, never thrown, so the
 * Workflow does not retry a run that has already spent a song; only a run that cannot even record its failure rejects.
 *
 * @param deps - Claude, Eleven Music, and storage.
 * @param run - The run the web service recorded and started.
 * @returns How the run ended.
 */
export async function runOdePipeline(deps: OdePipelineDeps, run: RunId): Promise<OdeRunOutcome> {
  let error: MakeOdeError;
  try {
    const result = await produce(deps, run);
    if (result._tag === "ok") return result.value;
    error = result.error;
  } catch (cause) {
    // A defect (a database error, a bug): the run must still say it failed, so the payer can retry.
    console.error("making the Ode crashed:", cause);
    error = new OdeRunCrashed(cause);
  }
  console.error(`making the Ode failed (${error._tag}):`, error);
  await deps.runs.fail(run, failureOf(error));
  return "failed";
}
