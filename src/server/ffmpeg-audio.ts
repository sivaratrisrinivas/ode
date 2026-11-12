import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MP3_BITRATE_KBPS, MP3_SAMPLE_RATE } from "./elevenlabs.ts";
import { AudioToolsUnavailable, type AudioTools } from "./ports.ts";
import { err, ok, type Result } from "./result.ts";

const execFileAsync = promisify(execFile);

/** What running ffmpeg once left: its exit was clean (a non-zero exit throws), and `stderr` is where it reports what it did. */
export type RunFfmpeg = (args: readonly string[]) => Promise<{ stderr: string }>;

/** The ffmpeg on the PATH, or at `file`. */
function ffmpegAt(file: string): RunFfmpeg {
  // A generous buffer: ffmpeg prints a progress line for every few frames.
  return (args) => execFileAsync(file, [...args], { maxBuffer: 64 * 1024 * 1024 });
}

/** The last `time=HH:MM:SS.cc` ffmpeg printed while decoding to nowhere: how long the audio plays once decoded, which a VBR header can misstate. */
function decodedMs(stderr: string): number | undefined {
  const times = [...stderr.matchAll(/time=(\d+):(\d{2}):(\d{2})\.(\d{2})/g)];
  const last = times.at(-1);
  if (last === undefined) return undefined;
  const [, hours = "0", minutes = "0", seconds = "0", hundredths = "0"] = last;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(hundredths) * 10;
}

/** Below this level (dBFS) a stem counts as silent when finding where its sound begins. */
const SILENCE_FLOOR_DB = -40;

/** Where the first sound is, in ms, from `silencedetect`'s report: 0 when the audio does not start in silence, the whole length when it is all silent. */
function leadingSilenceFrom(stderr: string): number | undefined {
  const start = /silence_start: (-?[\d.]+)/.exec(stderr);
  if (start === null) return 0;
  // A silence that begins later than the first few ms is not leading.
  if (Number(start[1]) > 0.05) return 0;
  const end = /silence_end: ([\d.]+)/.exec(stderr);
  return end === null ? decodedMs(stderr) : Math.round(Number(end[1]) * 1000);
}

/** The loudest a remix may get, as a fraction of full scale; below 1 so the MP3 encoder's own overshoot does not clip either. */
const PEAK_LIMIT = 0.9;

/**
 * The audio tools on ffmpeg: measure how long audio plays by decoding it, and find where audio first sounds, and mix two stems into one MP3 (summed, then limited so the sum cannot clip).
 * Audio goes through a temporary directory, which is removed afterwards.
 *
 * @param options - `ffmpeg` is the executable (default `ffmpeg` on the PATH); `run` replaces running it, for tests.
 */
export function createFfmpegAudio(options: { ffmpeg?: string; run?: RunFfmpeg } = {}): AudioTools {
  const run = options.run ?? ffmpegAt(options.ffmpeg ?? "ffmpeg");

  /** Write each input to a temporary directory, run `work` over their paths, and always remove the directory. */
  async function inTemporaryDirectory<T>(inputs: readonly Uint8Array[], work: (paths: string[], output: string) => Promise<T>): Promise<Result<T, AudioToolsUnavailable>> {
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), "ode-audio-"));
      const paths = await Promise.all(
        inputs.map(async (bytes, index) => {
          const path = join(directory ?? "", `in-${index}.mp3`);
          await writeFile(path, bytes);
          return path;
        }),
      );
      return ok(await work(paths, join(directory, "out.mp3")));
    } catch (cause) {
      // ffmpeg missing or exiting non-zero, or the disk refusing: no audio either way.
      return err(new AudioToolsUnavailable(cause));
    } finally {
      if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    }
  }

  return {
    async durationMs(audio) {
      const measured = await inTemporaryDirectory([audio], async ([input = ""]) => decodedMs((await run(["-hide_banner", "-nostdin", "-i", input, "-f", "null", "-"])).stderr));
      if (measured._tag === "err") return measured;
      return measured.value === undefined ? err(new AudioToolsUnavailable("ffmpeg did not report how long the audio plays")) : ok(measured.value);
    },

    async leadingSilenceMs(audio) {
      const measured = await inTemporaryDirectory([audio], async ([input = ""]) =>
        leadingSilenceFrom((await run(["-hide_banner", "-nostdin", "-i", input, "-af", `silencedetect=noise=${SILENCE_FLOOR_DB}dB:d=0.05`, "-f", "null", "-"])).stderr),
      );
      if (measured._tag === "err") return measured;
      return measured.value === undefined ? err(new AudioToolsUnavailable("ffmpeg did not report how long the audio plays")) : ok(measured.value);
    },

    async mix({ vocals, music }) {
      return inTemporaryDirectory([vocals, music], async ([first = "", second = ""], output) => {
        await run([
          "-hide_banner",
          "-nostdin",
          "-y",
          "-i",
          first,
          "-i",
          second,
          // The stems are one song split in two, so they are summed, not averaged down; the limiter keeps a sum that is louder than the song from clipping.
          "-filter_complex",
          `amix=inputs=2:duration=longest:normalize=0,alimiter=limit=${PEAK_LIMIT}:level=disabled`,
          "-c:a",
          "libmp3lame",
          "-b:a",
          `${MP3_BITRATE_KBPS}k`,
          "-ar",
          String(MP3_SAMPLE_RATE),
          output,
        ]);
        return new Uint8Array(await readFile(output));
      });
    },
  };
}
