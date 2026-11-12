import type { ChunkPlan, WordTiming } from "./ode.ts";
import { elevenLabsUrl } from "./elevenlabs.ts";
import { MusicUnavailable, type ComposedSong, type ElevenMusic } from "./ports.ts";
import { err, ok, type Result } from "./result.ts";

const ENDPOINT = elevenLabsUrl("/v1/music/detailed", { audio: true });
const MODEL = "music_v2_5";
/** Composing takes seconds; this only stops a hung request from holding a run forever. */
const TIMEOUT_MS = 120_000;

interface Part {
  readonly contentType: string;
  readonly body: Buffer;
}

/** Split a `multipart/mixed` reply into its parts; undefined when the reply has no boundary or no parts. */
function splitMultipart(body: Buffer, contentType: string): Part[] | undefined {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const name = boundary?.[1] ?? boundary?.[2];
  if (name === undefined) return undefined;

  const delimiter = Buffer.from(`--${name}`);
  const parts: Part[] = [];
  let at = body.indexOf(delimiter);
  while (at !== -1) {
    const start = at + delimiter.length;
    // "--" right after a delimiter closes the message.
    if (body.subarray(start, start + 2).toString("latin1") === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    // A part runs from the line break after its delimiter to the line break before the next one.
    const part = body.subarray(start + 2, next - 2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("latin1");
      const type = /^content-type:\s*([^;\r\n]+)/im.exec(headers)?.[1]?.trim().toLowerCase() ?? "";
      parts.push({ contentType: type, body: part.subarray(headerEnd + 4) });
    }
    at = next;
  }
  return parts.length === 0 ? undefined : parts;
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

/** Word timings from the metadata part; entries that are not a word with a start and an end are skipped, since they cannot be aligned. */
function parseWords(metadata: unknown): WordTiming[] {
  const raw = field(metadata, "words_timestamps");
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown): WordTiming[] => {
    const text = field(entry, "word");
    const startMs = field(entry, "start_ms");
    const endMs = field(entry, "end_ms");
    return typeof text === "string" && typeof startMs === "number" && typeof endMs === "number" ? [{ text, startMs, endMs }] : [];
  });
}

function parseSong(body: Buffer, contentType: string): Result<ComposedSong, MusicUnavailable> {
  const parts = splitMultipart(body, contentType);
  const audio = parts?.find((part) => part.contentType.startsWith("audio/"));
  const metadata = parts?.find((part) => part.contentType === "application/json");
  if (audio === undefined || audio.body.length === 0) return err(new MusicUnavailable("the reply had no audio part"));

  let words: WordTiming[] = [];
  if (metadata !== undefined) {
    try {
      words = parseWords(JSON.parse(metadata.body.toString("utf8")));
    } catch {
      // Unreadable timings only cost the line windows (equal quarters take over); the song itself is fine.
    }
  }
  return ok({ audio: new Uint8Array(audio.body), words });
}

/**
 * The production Eleven Music port: one `POST /v1/music/detailed` call per Ode with a chunk per
 * section, asking for word timestamps. The reply is `multipart/mixed`: metadata JSON, then the MP3.
 *
 * @param options - An ElevenLabs API key; `fetch` is replaceable for tests.
 */
export function createElevenMusic(options: { apiKey: string; fetch?: typeof fetch }): ElevenMusic {
  const send = options.fetch ?? fetch;

  return {
    async compose(chunks: readonly ChunkPlan[]) {
      try {
        const response = await send(ENDPOINT, {
          method: "POST",
          headers: { "xi-api-key": options.apiKey, "content-type": "application/json" },
          body: JSON.stringify({
            model_id: MODEL,
            with_timestamps: true,
            composition_plan: {
              chunks: chunks.map((chunk) => ({
                text: chunk.text,
                duration_ms: chunk.durationMs,
                positive_styles: chunk.styles,
                negative_styles: chunk.avoidStyles,
                context_adherence: "high",
              })),
            },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) {
          return err(new MusicUnavailable(new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)));
        }
        return parseSong(Buffer.from(await response.arrayBuffer()), response.headers.get("content-type") ?? "");
      } catch (cause) {
        // Network failure, timeout, or a reply that could not be read: no song either way.
        return err(new MusicUnavailable(cause));
      }
    },
  };
}
