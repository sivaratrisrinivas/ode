import { elevenLabsUrl, MP3_BYTES_PER_SECOND } from "../server/elevenlabs.ts";
import { buildOde, type ChunkPlan, type WordTiming } from "../server/ode.ts";
import type { ElevenMusic, MusicUnavailable } from "../server/ports.ts";
import { err, ok, type Result } from "../server/result.ts";
import type { SeedOdeFailureTag } from "./seed-ode.ts";

/** ElevenLabs credits at one moment: what this billing period has used, and what the plan allows. */
export interface Credits {
  readonly used: number;
  readonly limit: number;
}

/** The credit balance could not be read: network, a rejected key, or a reply without the counts. */
export class CreditsUnavailable extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "CreditsUnavailable" as const;

  /** @param cause - What went wrong, for the operator's log. */
  constructor(cause: unknown) {
    super("The ElevenLabs credit balance is unavailable", { cause });
  }
}

const SUBSCRIPTION_URL = elevenLabsUrl("/v1/user/subscription");

/**
 * Read the ElevenLabs credit balance (`character_count` of `character_limit`, which is how the subscription API counts
 * credits, music included). Call it before and after a run: the difference is what the run cost.
 *
 * @param options - An ElevenLabs API key; `fetch` is replaceable for tests.
 * @returns The balance, or why it could not be read (a failure here never stops a run, it only leaves the cost unknown).
 */
export async function readElevenCredits(options: { apiKey: string; fetch?: typeof fetch }): Promise<Result<Credits, CreditsUnavailable>> {
  const send = options.fetch ?? fetch;
  try {
    const response = await send(SUBSCRIPTION_URL, { headers: { "xi-api-key": options.apiKey }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return err(new CreditsUnavailable(`HTTP ${response.status}`));
    const body: unknown = await response.json();
    const used = typeof body === "object" && body !== null ? Reflect.get(body, "character_count") : undefined;
    const limit = typeof body === "object" && body !== null ? Reflect.get(body, "character_limit") : undefined;
    if (typeof used !== "number" || typeof limit !== "number") return err(new CreditsUnavailable("the reply had no credit counts"));
    return ok({ used, limit });
  } catch (cause) {
    // Network failure, timeout, or a reply that is not JSON: the balance is unknown either way.
    return err(new CreditsUnavailable(cause));
  }
}

/** What a clip run needs to be, in the day-1 probe's own words (`docs/plan/probes/line-chunk-plan.json`). */
const CLIP_STYLES = ["warm acoustic pop", "nostalgic summer road trip", "male lead vocals", "96 BPM", "acoustic guitar", "light brushed drums"];
const CLIP_AVOID = ["metal", "screaming", "autotune"];

/**
 * The 35-second clip the reliability runs compose: the day-1 probe's shape, an intro (6 s), four lines of one friend's verse
 * (5 s each) and the hook (9 s). It costs a fraction of a whole Ode but exercises the same Eleven Music call.
 *
 * @param lines - One friend's four verse lines; extra lines are ignored, missing ones leave the clip shorter.
 * @param hook - The hook line.
 */
export function clipPlan(lines: readonly string[], hook: string): ChunkPlan[] {
  const chunk = (text: string, durationMs: number, styles: readonly string[]): ChunkPlan => ({ text, durationMs, styles, avoidStyles: CLIP_AVOID });
  return [
    chunk("[Intro]", 6_000, [...CLIP_STYLES, "instrumental intro"]),
    ...lines.slice(0, 4).map((line, index) => chunk(index === 0 ? `[Verse 1]\n${line}` : line, 5_000, ["clear male vocals", "acoustic guitar", "intimate"])),
    chunk(`[Hook]\n${hook}`, 9_000, ["catchy hook", "group harmonies", "full band"]),
  ];
}

/** The clip came back, but its audio is not the length that was planned, so every window in it would be wrong. */
export class ClipWrongLength extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "ClipWrongLength" as const;

  /**
   * @param plannedSeconds - The length the plan adds up to.
   * @param audioSeconds - The length the returned audio has.
   */
  constructor(plannedSeconds: number, audioSeconds: number) {
    super(`The clip is ${audioSeconds.toFixed(1)} s long, not the ${plannedSeconds.toFixed(1)} s planned`);
  }
}

/** How far from the plan a clip may run: the day-1 probe came back 0.04 s over, so this only catches a truncated or padded song. */
const LENGTH_TOLERANCE_SECONDS = 3;

/** A clip that came back right. */
export interface ClipDone {
  readonly audio: Uint8Array;
  /** Estimated from the byte count at the app's MP3 bitrate (`MP3_BYTES_PER_SECOND`), so it is close, not exact. */
  readonly audioSeconds: number;
  /** The sung words with their times, as Eleven Music returned them; empty when no timestamps came back. */
  readonly words: readonly WordTiming[];
}

/** How a clip's line windows were found: from the sung words, or as equal quarters because the words did not line up (ADR 0001). */
export type LineWindows = "aligned" | "equal-quarter fallback";

/**
 * Whether the clip's four lines can be found in the sung words the way the app finds a verse's lines (`buildOde`), so a clip run
 * also shows that word timestamps came back and line up. The verse is the stretch after the intro that the line chunks fill.
 *
 * @param plan - The plan that was composed, normally `clipPlan(...)`.
 * @param lines - The lines the plan sings, as given to `clipPlan`.
 * @param words - The sung words from the clip.
 * @returns `aligned`, or `equal-quarter fallback` when the words are missing or do not match the lines.
 */
export function clipLineWindows(plan: readonly ChunkPlan[], lines: readonly string[], words: readonly WordTiming[]): LineWindows {
  const startMs = plan[0]?.durationMs ?? 0;
  const endMs = plan.slice(0, -1).reduce((total, chunk) => total + chunk.durationMs, 0);
  const { unaligned } = buildOde({ chunks: plan, sections: [{ kind: "verse", friend: "clip", lines: lines.slice(0, 4), startMs, endMs }] }, words);
  return unaligned.length === 0 ? "aligned" : "equal-quarter fallback";
}

/**
 * Compose one clip and judge it: Eleven Music must answer, and the audio must be about as long as the plan.
 *
 * @param music - Eleven Music, real or fake.
 * @param plan - The chunks to compose, normally `clipPlan(...)`.
 * @returns The audio, or `MusicUnavailable` when the call failed, or `ClipWrongLength` when it succeeded with the wrong length.
 */
export async function runClip(music: ElevenMusic, plan: readonly ChunkPlan[]): Promise<Result<ClipDone, MusicUnavailable | ClipWrongLength>> {
  const song = await music.compose(plan);
  if (song._tag === "err") return err(song.error);
  const plannedSeconds = plan.reduce((total, chunk) => total + chunk.durationMs, 0) / 1000;
  const audioSeconds = song.value.audio.length / MP3_BYTES_PER_SECOND;
  if (Math.abs(audioSeconds - plannedSeconds) > LENGTH_TOLERANCE_SECONDS) return err(new ClipWrongLength(plannedSeconds, audioSeconds));
  return ok({ audio: song.value.audio, audioSeconds, words: song.value.words });
}

/** One reliability run, as logged: a clip or the full Ode, whether it worked, how long it took and what it cost. */
export interface RunRecord {
  readonly kind: "clip" | "full";
  /** What the report calls the run ("clip 3", "full Ode"). */
  readonly label: string;
  readonly ok: boolean;
  /** Why it failed, from the failure tags the app records (through `SeedOdeFailureTag`) plus `ClipWrongLength`; absent when it worked. */
  readonly tag?: SeedOdeFailureTag | "ClipWrongLength";
  readonly seconds: number;
  /** ElevenLabs credits the run used, from the balance before and after it; undefined when a balance could not be read. */
  readonly credits?: number | undefined;
  /** For a clip that came back: whether its line windows were found from the sung words or fell back to equal quarters. */
  readonly lineWindows?: LineWindows;
}

/** The share of runs that may fail before the video uses the fallback: above this, the live Ode is too risky to film. */
const MAX_FAILURE_RATE = 0.1;

/** The decision rule, as the notes and the decision both state it. */
export const DECISION_RULE = `failure rate high (more than ${MAX_FAILURE_RATE * 100}% of runs, or the full run fails) -> use the labeled fallback in the video.`;

/**
 * Apply the decision rule: the labeled fallback when more than 10% of the runs failed, or when the full run failed, since the
 * full run is what the video would film. With no runs at all nothing shows the live Ode works, so the answer is `fallback`
 * (not `live`, and not a rate of 0 of 0).
 *
 * @param records - Every run.
 * @returns `fallback` or `live`.
 */
export function decide(records: readonly RunRecord[]): "live" | "fallback" {
  if (records.length === 0) return "fallback";
  const failed = records.filter((record) => !record.ok);
  const fullFailed = failed.some((record) => record.kind === "full");
  return fullFailed || failed.length / records.length > MAX_FAILURE_RATE ? "fallback" : "live";
}

/** What Claude was asked across the runs: counts, since the app's Claude port does not price calls. */
export interface ClaudeUsage {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * The reliability report, as Markdown for `notes/`.
 *
 * @param report - The date, every run, the ElevenLabs balance before and after (undefined when unreadable) and Claude's usage.
 *   With no runs the failure rate reads "no runs" (never NaN) and the decision is the fallback, as `decide` says.
 */
export function renderReport(report: {
  date: string;
  records: readonly RunRecord[];
  creditsBefore: Credits | undefined;
  creditsAfter: Credits | undefined;
  claude: ClaudeUsage;
}): string {
  const { records, creditsBefore, creditsAfter, claude } = report;
  const failed = records.filter((record) => !record.ok).length;
  const rows = records.map(
    (record) => `| ${record.label} | ${record.ok ? "ok" : "failed"} | ${record.tag ?? ""} | ${record.seconds.toFixed(1)} | ${record.credits ?? "-"} | ${record.lineWindows ?? "-"} |`,
  );
  const credits =
    creditsBefore !== undefined && creditsAfter !== undefined
      ? `${creditsBefore.used} before, ${creditsAfter.used} after, ${creditsAfter.used - creditsBefore.used} used (of ${creditsAfter.limit})`
      : "balance unreadable, see the per-run column";
  return [
    `# Reliability runs, ${report.date}`,
    "",
    "| Run | Result | Failure tag | Seconds | Credits | Line windows |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    records.length === 0 ? "Failure rate: no runs were made" : `Failure rate: ${failed} of ${records.length} runs (${Math.round((failed / records.length) * 100)}%)`,
    `ElevenLabs credits: ${credits}`,
    `Claude: ${claude.calls} calls, ${claude.inputTokens} input tokens, ${claude.outputTokens} output tokens`,
    "",
    `Decision rule: ${DECISION_RULE}`,
    `Decision: use the ${decide(records) === "fallback" ? "labeled fallback" : "live Ode"} in the video${records.length === 0 ? " (no runs were made, so nothing shows the live Ode works)" : ""}.`,
    "",
  ].join("\n");
}
