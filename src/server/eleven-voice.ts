import { elevenLabsUrl } from "./elevenlabs.ts";
import { VoiceUnavailable, type ElevenVoice } from "./ports.ts";
import { err, ok, type Result } from "./result.ts";
import { readZip } from "./zip.ts";

const SEPARATE_ENDPOINT = elevenLabsUrl("/v1/music/stem-separation", { audio: true });
/** Vocals and music, nothing finer. */
const STEM_VARIATION = "two_stems_v1";
const STS_MODEL = "eleven_multilingual_sts_v2";
/** Splitting took 8 s and converting 7 s for a 35 s song in the day-1 probe; this only stops a hung request from holding the command forever. */
const TIMEOUT_MS = 300_000;

/** Send one multipart request and read the reply's bytes; any failure is a `VoiceUnavailable` value. */
async function post(send: typeof fetch, apiKey: string, url: string, form: FormData): Promise<Result<Uint8Array, VoiceUnavailable>> {
  try {
    const response = await send(url, { method: "POST", headers: { "xi-api-key": apiKey }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return err(new VoiceUnavailable(new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)));
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length === 0 ? err(new VoiceUnavailable("the reply was empty")) : ok(bytes);
  } catch (cause) {
    // Network failure or timeout: no audio either way.
    return err(new VoiceUnavailable(cause));
  }
}

/** A multipart file field; the bytes are copied because a Blob must be backed by a plain ArrayBuffer. */
function audioFile(bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" });
}

/**
 * The production ElevenLabs voice port: `POST /v1/music/stem-separation` (`two_stems_v1`, a ZIP of `vocals.mp3` and
 * `instrumental.mp3`) and `POST /v1/voice-changer/{voice_id}` (`eleven_multilingual_sts_v2`), both asking for `MP3_OUTPUT_FORMAT`.
 *
 * @param options - An ElevenLabs API key, the payer's cloned voice ID, and a replaceable `fetch` for tests.
 */
export function createElevenVoice(options: { apiKey: string; voiceId: string; fetch?: typeof fetch }): ElevenVoice {
  const send = options.fetch ?? fetch;

  return {
    async separate(audio) {
      const form = new FormData();
      form.append("file", audioFile(audio), "ode.mp3");
      form.append("stem_variation_id", STEM_VARIATION);
      const reply = await post(send, options.apiKey, SEPARATE_ENDPOINT, form);
      if (reply._tag === "err") return reply;

      const entries = readZip(reply.value);
      if (entries._tag === "err") return err(new VoiceUnavailable(entries.error));
      const vocals = entries.value.find((entry) => /vocal/i.test(entry.name));
      const others = entries.value.filter((entry) => entry !== vocals);
      // Two stems were asked for: the singing, and the one other file is the music.
      if (vocals === undefined || others.length !== 1 || others[0] === undefined) {
        return err(new VoiceUnavailable(new Error(`expected a vocals file and one other in the ZIP, got: ${entries.value.map((entry) => entry.name).join(", ")}`)));
      }
      return ok({ vocals: vocals.data, music: others[0].data });
    },

    async convert(vocals) {
      const form = new FormData();
      form.append("audio", audioFile(vocals), "vocals.mp3");
      form.append("model_id", STS_MODEL);
      return post(send, options.apiKey, elevenLabsUrl(`/v1/voice-changer/${encodeURIComponent(options.voiceId)}`, { audio: true }), form);
    },
  };
}
