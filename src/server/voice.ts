/** Whose voice sings an Ode's audio: Eleven Music's own, or the payer's cloned voice (only the Seeded Ode, once converted; ADR 0002). */
export const ODE_VOICES = ["eleven-music", "payer"] as const;

/** One of `ODE_VOICES`. */
export type OdeVoice = (typeof ODE_VOICES)[number];

/** The voice a newly made Ode is sung in. */
export const DEFAULT_VOICE: OdeVoice = "eleven-music";

/**
 * What the cassette page says about the voice, null when it says nothing. The one place the words live: if the voice test
 * (H3) says the clone is not recognised, change the `payer` label to "a voice like mine" and nothing else.
 */
export const VOICE_LABELS: Readonly<Record<OdeVoice, string | null>> = {
  "eleven-music": null,
  payer: "in my voice",
};
