import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SeededOde } from "./seed-ode.ts";

/** The recorded fallback's audio, inside the directory it is written to. */
export const FALLBACK_AUDIO_FILE = "seeded-ode-fallback.mp3";
/** The recorded fallback's description, beside the audio. */
export const FALLBACK_DESCRIPTION_FILE = "seeded-ode-fallback.json";

/**
 * Keep a built Seeded Ode as the recorded fallback: the audio, and a description that says it is a recording, so a video that
 * uses it can label it and nothing mistakes it for a live run.
 *
 * @param dir - An existing directory to write both files in (`seed/`); a file already there is replaced.
 * @param seeded - The Seeded Ode as built.
 * @param made - When it was built and which notes it came from.
 */
export function writeFallbackRecording(dir: string, seeded: SeededOde, made: { madeAt: Date; source: string }): void {
  writeFileSync(join(dir, FALLBACK_AUDIO_FILE), seeded.audio);
  const description = {
    label: "RECORDING of a Seeded Ode build, not a live run. Label it as a recording wherever it is shown.",
    madeAt: made.madeAt.toISOString(),
    source: made.source,
    trip: seeded.ledger.trip,
    friends: seeded.ledger.rows.map((row) => ({ name: row.friend, amountOwedCents: row.amountOwedCents, insideJoke: row.insideJoke })),
    lyrics: seeded.lyrics,
    durationMs: seeded.ode.durationMs,
    sections: seeded.ode.sections,
    audio: FALLBACK_AUDIO_FILE,
  };
  writeFileSync(join(dir, FALLBACK_DESCRIPTION_FILE), `${JSON.stringify(description, null, 2)}\n`);
}
