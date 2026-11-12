import { createOdeStore } from "./ode-store.ts";
import { SEEDED } from "./owner.ts";
import type { AudioTools, AudioToolsUnavailable, ElevenVoice, Sql, VoiceUnavailable } from "./ports.ts";
import { err, ok, type Result } from "./result.ts";

/**
 * How far the converted audio's length may differ from the original's. The line windows were found in the original, so a
 * longer or shorter remix would put every line after the first in the wrong place. The day-1 probe's conversion was 90 ms
 * longer over 35 s; a line is about 5 s, so a quarter second is not heard.
 */
export const MAX_LENGTH_CHANGE_MS = 250;

/** There is no Seeded Ode to convert: it has not been made. */
export class NoSeededOde extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "NoSeededOde" as const;

  constructor() {
    super("The Seeded Ode is not made yet. Make it on the page first, then run this again.");
  }
}

/** The Seeded Ode's audio is already in the payer's voice; converting it again would only degrade it. */
export class AlreadyInPayersVoice extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "AlreadyInPayersVoice" as const;

  constructor() {
    super("The Seeded Ode is already in the payer's voice. To redo it, make the Seeded Ode again (build its ledger over) and run this once more.");
  }
}

/** The converted audio is not the length of the original, so the line windows would no longer match it. Nothing was replaced. */
export class LengthChanged extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "LengthChanged" as const;

  /**
   * @param originalMs - How long the Seeded Ode's audio plays now.
   * @param convertedMs - How long the converted remix plays.
   */
  readonly originalMs: number;
  readonly convertedMs: number;

  constructor(originalMs: number, convertedMs: number) {
    super(
      `The converted audio is ${convertedMs} ms long, the original ${originalMs} ms: more than ${MAX_LENGTH_CHANGE_MS} ms apart, so the line windows would not match. Nothing was replaced; try again, or keep Eleven Music's vocals.`,
    );
    this.originalMs = originalMs;
    this.convertedMs = convertedMs;
  }
}

/** The Seeded Ode was made again while it was being converted, so the conversion belongs to audio that is gone. Nothing was replaced. */
export class OdeChanged extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "OdeChanged" as const;

  constructor() {
    super("The Seeded Ode was made again while it was being converted. Nothing was replaced; run this again.");
  }
}

/** Why the Seeded Ode was not converted. */
export type ConvertVoiceError = NoSeededOde | AlreadyInPayersVoice | VoiceUnavailable | AudioToolsUnavailable | LengthChanged | OdeChanged;

/** What a conversion that replaced the audio measured. */
export interface VoiceConversion {
  /** How long the Seeded Ode's audio played before. */
  originalMs: number;
  /** How long the converted audio plays; within `MAX_LENGTH_CHANGE_MS` of `originalMs`. */
  convertedMs: number;
}

/**
 * Convert the Seeded Ode's audio into the payer's cloned voice and replace it (ADR 0002): split it into vocals and music,
 * sing the vocals in the cloned voice, mix them back over the music, check the result is as long as the original and store it.
 * The Ode's line windows are untouched, which is only right while the length is, so a remix whose length moved is refused.
 * No other owner's Ode is read or written.
 *
 * @param deps - The database, ElevenLabs (already holding the payer's voice ID) and the audio tools.
 * @returns What was measured; or why nothing was replaced: no Seeded Ode, already converted, a service failing, a length that
 *   moved, or the Ode being made again meanwhile. Every failure leaves the stored audio exactly as it was.
 */
export async function convertSeededVoice(deps: { sql: Sql; voice: ElevenVoice; audio: AudioTools }): Promise<Result<VoiceConversion, ConvertVoiceError>> {
  const odes = createOdeStore(deps.sql, SEEDED);
  const original = await odes.readAudio();
  if (original === undefined) return err(new NoSeededOde());
  if ((await odes.voice()) === "payer") return err(new AlreadyInPayersVoice());

  // Measured first, so missing audio tools are found before any ElevenLabs credits are spent.
  const originalMs = await deps.audio.durationMs(original);
  if (originalMs._tag === "err") return originalMs;

  const stems = await deps.voice.separate(original);
  if (stems._tag === "err") return stems;
  const sung = await deps.voice.convert(stems.value.vocals);
  if (sung._tag === "err") return sung;
  const mixed = await deps.audio.mix({ vocals: sung.value, music: stems.value.music });
  if (mixed._tag === "err") return mixed;

  const convertedMs = await deps.audio.durationMs(mixed.value);
  if (convertedMs._tag === "err") return convertedMs;
  if (Math.abs(convertedMs.value - originalMs.value) > MAX_LENGTH_CHANGE_MS) return err(new LengthChanged(originalMs.value, convertedMs.value));

  if (!(await odes.replaceAudio(original, mixed.value, "payer"))) return err(new OdeChanged());
  return ok({ originalMs: originalMs.value, convertedMs: convertedMs.value });
}
