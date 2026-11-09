import type { LedgerStore } from "./ledger-service.ts";
import { writeLyrics, type LyricsStore, type WriteLyricsError } from "./lyrics-service.ts";
import { lyricFriends, type LedgerNotReady } from "./lyrics.ts";
import { buildOde, planOde, type Ode } from "./ode.ts";
import type { Claude, ElevenMusic, MusicUnavailable } from "./ports.ts";
import { err, ok, type Result } from "./result.ts";

/** What the Ode service needs from storage for the one Ode. */
export interface OdeStore {
  /** The saved Ode; undefined until one has been made for the current ledger. */
  read(): Promise<Ode | undefined>;
  /** The saved Ode's audio; undefined when there is no Ode. */
  readAudio(): Promise<Uint8Array | undefined>;
  /** Save the Ode and its audio together, all or nothing, in place of any current Ode. */
  save(ode: Ode, audio: Uint8Array): Promise<void>;
}

/** The steps of making the Ode, in the order they run. */
export const ODE_STEPS = ["writing", "composing", "finding-lines"] as const;

/** Where a run is: the lyrics are being written (or read), the song composed, or the line windows found and saved. */
export type OdeStep = (typeof ODE_STEPS)[number];

/** An Ode is already saved, and making a new one is out of scope. */
export class OdeAlreadyMade extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "OdeAlreadyMade" as const;

  /** Takes no arguments: the message tells the payer how to start over. */
  constructor() {
    super("The Ode is already made. Build the ledger again to start over.");
  }
}

/** Something unexpected, not a known failure, stopped a run. */
export class OdeRunCrashed extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "OdeRunCrashed" as const;

  /** @param cause - The unexpected error, kept for the operator's log. */
  constructor(cause: unknown) {
    super("Making the Ode stopped unexpectedly", { cause });
  }
}

/** Why a run could not be started. */
export type StartOdeError = LedgerNotReady | OdeAlreadyMade;

/** Why a run that started did not produce an Ode. */
export type MakeOdeError = WriteLyricsError | MusicUnavailable | OdeRunCrashed;

/** The run in progress. */
export interface MakingOde {
  readonly _tag: "Making";
  readonly step: OdeStep;
}

/** Where the Ode stands: not made, being made, failed (nothing saved), or ready to play. */
export type OdeStatus =
  | { readonly _tag: "NotMade" }
  | MakingOde
  | { readonly _tag: "Failed"; readonly error: MakeOdeError }
  | { readonly _tag: "Ready"; readonly ode: Ode };

/** Makes the Ode from the saved lyrics, in the background of the web service. */
export interface OdeMaker {
  /**
   * Start making the Ode. A run already in progress is not started twice.
   *
   * @returns The run in progress, or why none could start.
   */
  start(): Promise<Result<MakingOde, StartOdeError>>;
  /** The current status, for the payer to poll. */
  status(): Promise<OdeStatus>;
}

type RunState = { readonly _tag: "Idle" } | MakingOde | { readonly _tag: "Failed"; readonly error: MakeOdeError };

/**
 * Create the Ode maker. Its run state lives in this process, so a restart forgets a run in
 * progress or a failure; an Ode that was saved is kept. The Render Workflow (#25) replaces this.
 *
 * @param deps - Claude and Eleven Music, the ledger, lyrics and Ode stores.
 */
export function createOdeMaker(deps: {
  claude: Claude;
  music: ElevenMusic;
  ledger: Pick<LedgerStore, "read">;
  lyrics: LyricsStore;
  odes: OdeStore;
}): OdeMaker {
  let run: RunState = { _tag: "Idle" };

  /** Write the lyrics when none are saved, compose, find the line windows, then save. Nothing is saved before the end. */
  async function produce(): Promise<Result<void, MakeOdeError>> {
    const saved = await deps.lyrics.read();
    const lyrics =
      saved !== undefined ? ok(saved) : await writeLyrics({ claude: deps.claude, ledger: deps.ledger, store: deps.lyrics });
    if (lyrics._tag === "err") return err(lyrics.error);

    run = { _tag: "Making", step: "composing" };
    const plan = planOde(lyrics.value);
    const song = await deps.music.compose(plan.chunks);
    if (song._tag === "err") return err(song.error);

    run = { _tag: "Making", step: "finding-lines" };
    const { ode, unaligned } = buildOde(plan, song.value.words);
    for (const verse of unaligned) console.warn(`${verse.friend}'s verse falls back to equal quarters:`, verse.reason.message);
    await deps.odes.save(ode, song.value.audio);
    return ok(undefined);
  }

  async function execute(): Promise<void> {
    try {
      const result = await produce();
      if (result._tag === "ok") {
        run = { _tag: "Idle" };
      } else {
        console.error(`making the Ode failed (${result.error._tag}):`, result.error);
        run = { _tag: "Failed", error: result.error };
      }
    } catch (cause) {
      // A defect (a database error, a bug): the process must live on and the payer must be able to retry.
      console.error("making the Ode crashed:", cause);
      run = { _tag: "Failed", error: new OdeRunCrashed(cause) };
    }
  }

  return {
    async start() {
      if ((await deps.odes.read()) !== undefined) return err(new OdeAlreadyMade());
      const friends = lyricFriends(await deps.ledger.read());
      if (friends._tag === "err") return err(friends.error);

      // Checked and set with no await between, so two requests cannot both start a run.
      if (run._tag === "Making") return ok(run);
      run = { _tag: "Making", step: "writing" };
      void execute();
      return ok(run);
    },

    async status() {
      if (run._tag === "Making" || run._tag === "Failed") return run;
      const ode = await deps.odes.read();
      return ode === undefined ? { _tag: "NotMade" } : { _tag: "Ready", ode };
    },
  };
}
