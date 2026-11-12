/** Whose voice sings an Ode's audio: Eleven Music's own, or the payer's cloned voice (only the Seeded Ode, once converted; ADR 0002). */
export const ODE_VOICES = ["eleven-music", "payer"] as const;

/** One of `ODE_VOICES`. */
export type OdeVoice = (typeof ODE_VOICES)[number];

/** The voice a newly made Ode is sung in. */
export const DEFAULT_VOICE: OdeVoice = "eleven-music";

/**
 * The words for the payer's cloned voice, by `VOICE_LABEL`: the default, and `like` for when the H3 voice test says the clone
 * is not recognised as the payer. The one place the words live.
 */
export const PAYER_VOICE_WORDS = { default: "in my voice", like: "a voice like mine" } as const;

/**
 * What the cassette page says about each voice, null when it says nothing.
 *
 * @param setting - The `VOICE_LABEL` environment variable: `like` for "a voice like mine"; anything else, or unset, is "in my voice".
 */
export function voiceLabels(setting: string | undefined): Readonly<Record<OdeVoice, string | null>> {
  return { "eleven-music": null, payer: setting === "like" ? PAYER_VOICE_WORDS.like : PAYER_VOICE_WORDS.default };
}

/** The labels this process serves, read once from `VOICE_LABEL` at start. */
export const VOICE_LABELS = voiceLabels(process.env["VOICE_LABEL"]);
