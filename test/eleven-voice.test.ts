import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createElevenVoice } from "../src/server/eleven-voice.ts";

// The production adapter sits behind the ElevenVoice port, so the API tests never reach it. These tests give it a fake
// `fetch` (no network, no key) shaped like the real replies: a ZIP of `vocals.mp3` and `instrumental.mp3` for stem
// separation (probed 2026-11-11 with `two_stems_v1`), MP3 bytes for the voice changer.

const audio = Uint8Array.from([0x49, 0x44, 0x33, 0xff, 0xfb, 0x90, 0x00]);
const vocals = Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
const music = Uint8Array.from([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);

/** A ZIP archive laid out as the spec says, each file stored (method 0) or deflated (method 8). */
function zip(files: { name: string; data: Uint8Array; deflate?: boolean }[]): Uint8Array<ArrayBuffer> {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const body = file.deflate ? deflateRawSync(file.data) : Buffer.from(file.data);
    const name = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(file.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(file.data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(file.deflate ? 8 : 0, 10);
    entry.writeUInt32LE(crc32(file.data), 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    directory.push(entry, name);
    offset += local.length + name.length + body.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, central, end]));
}

interface Seen {
  url: string;
  headers: Headers;
  form: FormData;
}

/** A `fetch` that answers every request with `reply` and records what it was asked. */
function answering(reply: () => Response): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: async (url, init) => {
      const form = init?.body;
      if (!(form instanceof FormData)) throw new Error("the adapter sent something other than multipart form data");
      seen.push({ url: String(url), headers: new Headers(init?.headers), form });
      return reply();
    },
  };
}

async function bytesOf(field: FormDataEntryValue | null | undefined): Promise<number[]> {
  if (!(field instanceof Blob)) throw new Error("the form field is not a file");
  return [...new Uint8Array(await field.arrayBuffer())];
}

describe("the ElevenLabs voice adapter", () => {
  it("splits a song into two stems, reading vocals and music out of the ZIP wherever they are listed", async () => {
    const reply = zip([
      { name: "instrumental.mp3", data: music },
      { name: "vocals.mp3", data: vocals, deflate: true },
    ]);
    const { fetch, seen } = answering(() => new Response(reply, { headers: { "content-type": "application/zip" } }));

    const stems = await createElevenVoice({ apiKey: "test-key", voiceId: "voice-1", fetch }).separate(audio);

    expect(stems).toEqual({ _tag: "ok", value: { vocals, music } });
    expect(seen[0]?.url).toBe("https://api.elevenlabs.io/v1/music/stem-separation?output_format=mp3_44100_128");
    expect(seen[0]?.headers.get("xi-api-key")).toBe("test-key");
    expect(seen[0]?.form.get("stem_variation_id")).toBe("two_stems_v1");
    expect(await bytesOf(seen[0]?.form.get("file"))).toEqual([...audio]);
  });

  it("sings vocals in the payer's voice at 128 kbps and returns the audio", async () => {
    const converted = Uint8Array.from([9, 8, 7]);
    const { fetch, seen } = answering(() => new Response(converted, { headers: { "content-type": "audio/mpeg" } }));

    const result = await createElevenVoice({ apiKey: "test-key", voiceId: "my voice/id", fetch }).convert(vocals);

    expect(result).toEqual({ _tag: "ok", value: converted });
    expect(seen[0]?.url).toBe("https://api.elevenlabs.io/v1/voice-changer/my%20voice%2Fid?output_format=mp3_44100_128");
    expect(seen[0]?.form.get("model_id")).toBe("eleven_multilingual_sts_v2");
    expect(await bytesOf(seen[0]?.form.get("audio"))).toEqual([...vocals]);
  });

  it.each([
    ["separate", (voice: ReturnType<typeof createElevenVoice>) => voice.separate(audio)],
    ["convert", (voice: ReturnType<typeof createElevenVoice>) => voice.convert(vocals)],
  ])("reports %s failing with an HTTP error as a value naming the status", async (_name, call) => {
    const { fetch } = answering(() => new Response('{"detail":"quota exceeded"}', { status: 401 }));

    const result = await call(createElevenVoice({ apiKey: "bad", voiceId: "v", fetch }));

    expect(result).toMatchObject({ _tag: "err", error: { _tag: "VoiceUnavailable", cause: { message: expect.stringContaining("HTTP 401") } } });
  });

  it("reports a network failure as a value", async () => {
    const voice = createElevenVoice({
      apiKey: "k",
      voiceId: "v",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    expect(await voice.convert(vocals)).toMatchObject({ _tag: "err", error: { _tag: "VoiceUnavailable" } });
  });

  it.each([
    ["not a ZIP", () => new Response(Uint8Array.from([1, 2, 3, 4]))],
    ["a ZIP without vocals", () => new Response(zip([{ name: "a.mp3", data: music }, { name: "b.mp3", data: music }]))],
    ["a ZIP with three files", () => new Response(zip([{ name: "vocals.mp3", data: vocals }, { name: "b.mp3", data: music }, { name: "c.mp3", data: music }]))],
  ])("reports %s as a value", async (_name, reply) => {
    const { fetch } = answering(reply);

    const result = await createElevenVoice({ apiKey: "k", voiceId: "v", fetch }).separate(audio);

    expect(result).toMatchObject({ _tag: "err", error: { _tag: "VoiceUnavailable" } });
  });
});
