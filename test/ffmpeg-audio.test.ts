import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
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

  it("reads where the first sound is from silencedetect", async () => {
    const stderr = "[silencedetect @ 0x1] silence_start: -0.0012\n[silencedetect @ 0x1] silence_end: 6.0213 | silence_duration: 6.0225\nsize=N/A time=00:00:35.13 bitrate=N/A";
    const tools = createFfmpegAudio({ run: async () => ({ stderr }) });

    expect(await tools.leadingSilenceMs(audio)).toEqual({ _tag: "ok", value: 6_021 });
  });

  it("says 0 when the audio sounds at once, even if it goes quiet later", async () => {
    const stderr = "[silencedetect @ 0x1] silence_start: 20.5\n[silencedetect @ 0x1] silence_end: 22.0 | silence_duration: 1.5\nsize=N/A time=00:00:35.13 bitrate=N/A";
    const tools = createFfmpegAudio({ run: async () => ({ stderr }) });

    expect(await tools.leadingSilenceMs(audio)).toEqual({ _tag: "ok", value: 0 });
    expect(await createFfmpegAudio({ run: async () => ({ stderr: "size=N/A time=00:00:35.13 bitrate=N/A" }) }).leadingSilenceMs(audio)).toEqual({ _tag: "ok", value: 0 });
  });

  it("says the whole length when the audio never sounds", async () => {
    const tools = createFfmpegAudio({ run: async () => ({ stderr: "[silencedetect @ 0x1] silence_start: 0\nsize=N/A time=00:00:35.13 bitrate=N/A" }) });

    expect(await tools.leadingSilenceMs(audio)).toEqual({ _tag: "ok", value: 35_130 });
  });

  it("mixes with the stems summed and then limited, at the app's bitrate", async () => {
    const seen: string[][] = [];
    const tools = createFfmpegAudio({
      run: async (args) => {
        seen.push([...args]);
        return { stderr: "" };
      },
    });

    // The fake ffmpeg writes no output file, so the read fails; the arguments are what is under test.
    await tools.mix({ vocals: audio, music: audio });

    const args = seen[0] ?? [];
    expect(args[args.indexOf("-filter_complex") + 1]).toMatch(/^amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0\.9:level=disabled$/);
    expect(args[args.indexOf("-b:a") + 1]).toBe("128k");
    expect(args[args.indexOf("-ar") + 1]).toBe("44100");
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

  it("does not clip when two loud stems sum past full scale, and finds where sound begins", async () => {
    const ffmpeg = process.env["FFMPEG_PATH"] ?? "ffmpeg";
    const run = promisify(execFile);
    const directory = await mkdtemp(join(tmpdir(), "ode-test-"));
    try {
      // A 440 Hz tone at about 0.9 of full scale after 1 s of silence; two of them in phase sum to about 1.8.
      const file = join(directory, "tone.mp3");
      await run(ffmpeg, ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-af", "volume=7,adelay=1000:all=1", "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", file]);
      const tone = new Uint8Array(await readFile(file));

      const mixed = await tools.mix({ vocals: tone, music: tone });
      if (mixed._tag === "err") throw mixed.error;
      const mixedFile = join(directory, "mixed.mp3");
      await writeFile(mixedFile, mixed.value);
      const { stderr } = await run(ffmpeg, ["-hide_banner", "-nostdin", "-i", mixedFile, "-af", "volumedetect", "-f", "null", "-"]);
      const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(stderr)?.[1]);

      // 0 dB is a clipped sample.
      expect(peak).toBeLessThan(0);
      // The first sound is the tone's, a second in.
      expect(await tools.leadingSilenceMs(tone)).toMatchObject({ _tag: "ok", value: expect.closeTo(1_000, -2) });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports audio that is not audio as a value", async () => {
    expect(await tools.durationMs(Uint8Array.from([1, 2, 3]))).toMatchObject({ _tag: "err", error: { _tag: "AudioToolsUnavailable" } });
  });
});
