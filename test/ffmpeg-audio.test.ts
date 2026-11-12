import { describe, expect, it } from "vitest";
import { createFfmpegAudio } from "../src/server/ffmpeg-audio.ts";

// The production adapter sits behind the AudioTools port, so the API tests never reach it. The first block gives it a fake
// ffmpeg that prints what ffmpeg prints; the second runs the real one, only when FFMPEG_PATH names it (it is not a
// dependency of the app: the operator's machine has it, the CI machine may not).

const audio = Uint8Array.from([0x49, 0x44, 0x33, 0xff, 0xfb, 0x90, 0x00]);

describe("the ffmpeg audio adapter, with a fake ffmpeg", () => {
  it("reads how long the audio plays from the last progress line of a decode", async () => {
    const tools = createFfmpegAudio({
      run: async () => ({ stderr: "Duration: 00:00:35.04, start: 0.0\nsize=N/A time=00:00:10.00 bitrate=N/A\rsize=N/A time=00:00:35.13 bitrate=N/A speed=300x\n" }),
    });

    expect(await tools.durationMs(audio)).toEqual({ _tag: "ok", value: 35_130 });
  });

  it("reads hours and minutes", async () => {
    const tools = createFfmpegAudio({ run: async () => ({ stderr: "size=N/A time=01:02:03.04 bitrate=N/A" }) });

    expect(await tools.durationMs(audio)).toEqual({ _tag: "ok", value: 3_723_040 });
  });

  it("reports ffmpeg missing, or failing, as a value", async () => {
    const tools = createFfmpegAudio({
      run: async () => {
        throw Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
      },
    });

    expect(await tools.durationMs(audio)).toMatchObject({ _tag: "err", error: { _tag: "AudioToolsUnavailable" } });
    expect(await tools.mix({ vocals: audio, music: audio })).toMatchObject({ _tag: "err", error: { _tag: "AudioToolsUnavailable" } });
  });

  it("reports output with no time in it as a value", async () => {
    const tools = createFfmpegAudio({ run: async () => ({ stderr: "nothing useful" }) });

    expect(await tools.durationMs(audio)).toMatchObject({ _tag: "err", error: { _tag: "AudioToolsUnavailable" } });
  });
});

/** MP3 silence: 417-byte MPEG-1 layer 3 frames at 128 kbps and 44.1 kHz, 26.12 ms each. */
function silence(frames: number): Uint8Array {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  const bytes = new Uint8Array(frames * frame.length);
  for (let index = 0; index < frames; index += 1) bytes.set(frame, index * frame.length);
  return bytes;
}

describe.skipIf(process.env["FFMPEG_PATH"] === undefined)("the ffmpeg audio adapter, with the real ffmpeg", () => {
  const tools = createFfmpegAudio({ ffmpeg: process.env["FFMPEG_PATH"] ?? "ffmpeg" });

  it("measures decoded length, and a mix of two stems is as long as they are", async () => {
    const stem = silence(400);

    const measured = await tools.durationMs(stem);
    const mixed = await tools.mix({ vocals: stem, music: silence(400) });
    const mixedMs = mixed._tag === "ok" ? await tools.durationMs(mixed.value) : mixed;

    expect(measured).toMatchObject({ _tag: "ok", value: expect.closeTo(10_450, -2) });
    expect(mixedMs).toMatchObject({ _tag: "ok", value: expect.closeTo(10_450, -3) });
  });

  it("reports audio that is not audio as a value", async () => {
    expect(await tools.durationMs(Uint8Array.from([1, 2, 3]))).toMatchObject({ _tag: "err", error: { _tag: "AudioToolsUnavailable" } });
  });
});
