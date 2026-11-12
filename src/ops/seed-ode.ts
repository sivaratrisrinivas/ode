import { proposeLedger, type StoredLedger } from "../server/ledger-service.ts";
import { createLedgerStore } from "../server/ledger-store.ts";
import type { Lyrics } from "../server/lyrics.ts";
import { writeLyrics } from "../server/lyrics-service.ts";
import { createLyricsStore } from "../server/lyrics-store.ts";
import type { Ode } from "../server/ode.ts";
import { createOdeJob } from "../server/ode-job.ts";
import { newRunId } from "../server/ode-run.ts";
import { createOdeStore } from "../server/ode-store.ts";
import { SEEDED } from "../server/owner.ts";
import type { Claude, ElevenMusic, Sql } from "../server/ports.ts";
import { parseReleaseDate } from "../server/release-date.ts";
import { err, ok, type Result } from "../server/result.ts";
import * as TripNotes from "../server/trip-notes.ts";

/**
 * The Seeded Ode could not be built. `tag` is the same vocabulary the app records for a failed run (`ODE_FAILURE_TAGS`),
 * plus the tags of the ledger and lyrics steps that come before a run and `OdeAlreadyMade` / `RunInProgress` for a
 * Seeded Ode that is already there.
 */
export class SeedOdeFailed extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "SeedOdeFailed" as const;

  /** Why, as one short tag. */
  readonly tag: string;

  /**
   * @param tag - Why, as one short tag.
   * @param detail - What to tell the operator.
   */
  constructor(tag: string, detail: string) {
    super(`Could not build the Seeded Ode (${tag}): ${detail}`);
    this.tag = tag;
  }
}

/** The Seeded Ode as built: what was saved, and the audio, for keeping as the recorded fallback. */
export interface SeededOde {
  readonly ledger: StoredLedger;
  readonly lyrics: Lyrics;
  readonly ode: Ode;
  readonly audio: Uint8Array;
}

/**
 * Build the Seeded Ode for real: trip notes to ledger (Claude), lyrics (Claude), then the same run the app makes (compose, line
 * windows, save), all under the Seeded Ode's owner. It is the operator's one-off, run against the database the app serves:
 * on Render, from the web service's shell, where `DATABASE_URL` is reachable.
 *
 * Refuses, before spending anything, when a Seeded Ode is already saved, unless `replace` is set: saving a new ledger deletes
 * the old lyrics, Ode and every friend's link (the friends' link tokens change, and each visitor's paid copy is lost).
 *
 * @param deps - The database, Claude and Eleven Music (real, for a real build), the notes, the clock reading and the release date
 *   the Ode promises (`YYYY-MM-DD`, today or later).
 * @returns The saved Seeded Ode, or `SeedOdeFailed` with the tag of the step that failed. Nothing is saved when the run fails.
 */
export async function buildSeededOde(deps: {
  sql: Sql;
  claude: Claude;
  music: ElevenMusic;
  notes: string;
  now: Date;
  releaseDate: string;
  replace?: boolean;
}): Promise<Result<SeededOde, SeedOdeFailed>> {
  const { sql, claude, music } = deps;
  const ledgerStore = createLedgerStore(sql, SEEDED);
  const lyricsStore = createLyricsStore(sql, SEEDED);
  const odes = createOdeStore(sql, SEEDED);

  const notes = TripNotes.parse(deps.notes);
  if (notes._tag === "err") return err(new SeedOdeFailed(notes.error._tag, notes.error.message));
  const releaseDate = parseReleaseDate(deps.releaseDate, deps.now);
  if (releaseDate._tag === "err") return err(new SeedOdeFailed(releaseDate.error._tag, releaseDate.error.message));
  if (deps.replace !== true && (await odes.read()) !== undefined) {
    return err(new SeedOdeFailed("OdeAlreadyMade", "a Seeded Ode is saved; pass replace to build it again"));
  }

  const ledger = await proposeLedger({ claude, store: ledgerStore }, notes.value);
  if (ledger._tag === "err") return err(new SeedOdeFailed(ledger.error._tag, ledger.error.message));
  const lyrics = await writeLyrics({ claude, ledger: ledgerStore, store: lyricsStore });
  if (lyrics._tag === "err") return err(new SeedOdeFailed(lyrics.error._tag, lyrics.error.message));

  const run = newRunId();
  if (!(await odes.begin(run, deps.now, releaseDate.value))) return err(new SeedOdeFailed("RunInProgress", "a Seeded Ode run is already in progress"));
  const outcome = await createOdeJob({ sql, claude, music })(run);
  if (outcome !== "ready") {
    const current = await odes.current();
    const tag = current?._tag === "Failed" ? current.failure._tag : "Superseded";
    return err(new SeedOdeFailed(tag, `the run ended as ${outcome}`));
  }

  const ode = await odes.read();
  const audio = await odes.readAudio();
  // Defect: the run reported "ready", which saves the Ode and its audio in one commit.
  if (ode === undefined || audio === undefined) throw new Error("the run was ready but the Seeded Ode is not saved");
  return ok({ ledger: ledger.value, lyrics: lyrics.value, ode, audio });
}
