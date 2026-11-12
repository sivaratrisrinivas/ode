/** Where every ElevenLabs request goes. */
export const ELEVENLABS_API = "https://api.elevenlabs.io";

/** Sample rate of the audio the app asks ElevenLabs for and the mixer writes, in hertz. */
export const MP3_SAMPLE_RATE = 44_100;

/** Bitrate of that audio, in kilobits a second. */
export const MP3_BITRATE_KBPS = 128;

/** The `output_format` ElevenLabs is asked for: MP3 at `MP3_SAMPLE_RATE` and `MP3_BITRATE_KBPS` (`mp3_44100_128`). */
export const MP3_OUTPUT_FORMAT = `mp3_${MP3_SAMPLE_RATE}_${MP3_BITRATE_KBPS}`;

/** Bytes of audio a second at `MP3_BITRATE_KBPS`: 16,000 at 128 kbps. Byte counts convert to seconds only approximately (headers, tags). */
export const MP3_BYTES_PER_SECOND = (MP3_BITRATE_KBPS * 1000) / 8;

/**
 * An ElevenLabs endpoint's URL.
 *
 * @param path - The path after the host, starting with `/` (`/v1/music/detailed`).
 * @param options - `audio` adds the app's `output_format`, for the endpoints that return audio.
 */
export function elevenLabsUrl(path: string, options: { audio?: boolean } = {}): string {
  return `${ELEVENLABS_API}${path}${options.audio === true ? `?output_format=${MP3_OUTPUT_FORMAT}` : ""}`;
}
