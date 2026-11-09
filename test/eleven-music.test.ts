import { describe, expect, it } from "vitest";
import { createElevenMusic } from "../src/server/eleven-music.ts";
import type { ChunkPlan } from "../src/server/ode.ts";

// The production adapter sits behind the Eleven Music port, so the API tests never reach it. These
// tests give it a fake `fetch` (no network, no key) shaped like the day-1 probe's reply
// (notes/day1-checks.md): multipart/mixed, the metadata JSON first, then the MP3.

const chunks: ChunkPlan[] = [
  { text: "[Intro]", styles: ["indie folk"], avoidStyles: ["metal"], durationMs: 6_000 },
  { text: "[Verse 1]\nTharun held the wheel", styles: ["intimate verse"], avoidStyles: [], durationMs: 20_000 },
];

// Bytes that include line breaks and dashes, as MP3 data may.
const audio = Uint8Array.from([0x49, 0x44, 0x33, 0x0d, 0x0a, 0x0d, 0x0a, 0x2d, 0x2d, 0xff, 0xfb, 0x90, 0x00]);

function multipart(parts: { type: string; body: Uint8Array | string }[], boundary = "ode-boundary"): { body: Uint8Array<ArrayBuffer>; type: string } {
  const pieces = parts.flatMap((part) => [
    Buffer.from(`--${boundary}\r\ncontent-type: ${part.type}\r\n\r\n`),
    Buffer.from(part.body),
    Buffer.from("\r\n"),
  ]);
  const body = new Uint8Array(Buffer.concat([...pieces, Buffer.from(`--${boundary}--\r\n`)]));
  return { body, type: `multipart/mixed; boundary=${boundary}` };
}

function replyWith(parts: { type: string; body: Uint8Array | string }[]): typeof fetch {
  const reply = multipart(parts);
  return async () => new Response(reply.body, { headers: { "content-type": reply.type } });
}

const metadata = {
  type: "application/json",
  body: JSON.stringify({
    words_timestamps: [
      { word: "Tharun", start_ms: 7_300, end_ms: 7_680 },
      { word: "held,", start_ms: 7_800, end_ms: 8_039 },
      { word: 42, start_ms: 1, end_ms: 2 },
    ],
  }),
};

describe("the Eleven Music adapter", () => {
  it("asks for one chunk per section with word timestamps, and reads back the audio and the words", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const reply = multipart([metadata, { type: "audio/mpeg", body: audio }]);
    const music = createElevenMusic({
      apiKey: "test-key",
      fetch: async (url, init) => {
        request = { url: String(url), init: init ?? {} };
        return new Response(reply.body, { headers: { "content-type": reply.type } });
      },
    });

    const song = await music.compose(chunks);

    expect(song).toEqual({
      _tag: "ok",
      value: {
        audio,
        words: [
          { text: "Tharun", startMs: 7_300, endMs: 7_680 },
          { text: "held,", startMs: 7_800, endMs: 8_039 },
        ],
      },
    });
    expect(request?.url).toBe("https://api.elevenlabs.io/v1/music/detailed?output_format=mp3_44100_128");
    expect(request?.init.method).toBe("POST");
    expect(request?.init.headers).toMatchObject({ "xi-api-key": "test-key" });
    expect(JSON.parse(String(request?.init.body))).toEqual({
      model_id: "music_v2_5",
      with_timestamps: true,
      composition_plan: {
        chunks: [
          { text: "[Intro]", duration_ms: 6_000, positive_styles: ["indie folk"], negative_styles: ["metal"], context_adherence: "high" },
          {
            text: "[Verse 1]\nTharun held the wheel",
            duration_ms: 20_000,
            positive_styles: ["intimate verse"],
            negative_styles: [],
            context_adherence: "high",
          },
        ],
      },
    });
  });

  it("still returns the song, without words, when the metadata is missing or unreadable", async () => {
    const withoutMetadata = createElevenMusic({ apiKey: "k", fetch: replyWith([{ type: "audio/mpeg", body: audio }]) });
    const garbled = createElevenMusic({
      apiKey: "k",
      fetch: replyWith([{ type: "application/json", body: "{not json" }, { type: "audio/mpeg", body: audio }]),
    });

    for (const music of [withoutMetadata, garbled]) {
      expect(await music.compose(chunks)).toEqual({ _tag: "ok", value: { audio, words: [] } });
    }
  });

  it.each([
    ["an HTTP error", async () => new Response("quota exceeded", { status: 401 })],
    ["a reply with no audio", replyWith([metadata])],
    ["a reply that is not multipart", async () => new Response("hello", { headers: { "content-type": "text/plain" } })],
    [
      "a network failure",
      async (): Promise<Response> => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("reports Eleven Music unavailable on %s", async (_case, send) => {
    const music = createElevenMusic({ apiKey: "k", fetch: send });

    const song = await music.compose(chunks);

    expect(song._tag).toBe("err");
    expect(song._tag === "err" && song.error._tag).toBe("MusicUnavailable");
  });
});
