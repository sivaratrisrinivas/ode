import type { Lyrics } from "./lyrics.ts";
import { err, ok, type Result } from "./result.ts";

/** One sung word and when it is sung, in milliseconds from the start of the song. */
export interface WordTiming {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** One chunk of the composition: its words, how long it runs and the sound asked for. */
export interface ChunkPlan {
  /** Section tag on its own first line (`[Verse 1]`), then the lines to sing. */
  readonly text: string;
  /** What the chunk should sound like. */
  readonly styles: readonly string[];
  /** What it must not sound like. */
  readonly avoidStyles: readonly string[];
  readonly durationMs: number;
}

/** A stretch of the song, in milliseconds from its start; `endMs` is after `startMs`. */
export interface TimeWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/** One lyric line and the stretch of the song it is sung in. */
export interface TimedLine extends TimeWindow {
  readonly text: string;
}

/** The instrumental opening. */
export interface IntroSection extends TimeWindow {
  readonly kind: "intro";
}

/** One friend's verse: one chunk, whose lines tile its window. */
export interface VerseSection extends TimeWindow {
  readonly kind: "verse";
  readonly friend: string;
  readonly lines: readonly TimedLine[];
}

/** The refrain after a verse; always audible. */
export interface HookSection extends TimeWindow {
  readonly kind: "hook";
  readonly text: string;
}

/** The final section, which drops only when every friend is repaid. */
export interface ChorusSection extends TimeWindow {
  readonly kind: "chorus";
  readonly text: string;
}

/** One part of the Ode, with the stretch of the song it occupies. */
export type Section = IntroSection | VerseSection | HookSection | ChorusSection;

/** The Ode's shape: its sections in song order, back to back from the start. */
export interface Ode {
  readonly sections: readonly Section[];
  /** Where the last section ends. */
  readonly durationMs: number;
}

/**
 * Assemble an Ode from its sections, so `durationMs` always agrees with them.
 *
 * @param sections - The sections in song order, back to back from the start.
 * @returns The Ode.
 */
export function makeOde(sections: readonly Section[]): Ode {
  return { sections, durationMs: sections.at(-1)?.endMs ?? 0 };
}

/** Length of the instrumental intro. */
const INTRO_MS = 6_000;
/** Length of one verse chunk: four lines at about five seconds each. */
const VERSE_MS = 20_000;
/** Length of one hook. */
const HOOK_MS = 8_000;
/** Length of the final chorus. */
const CHORUS_MS = 12_000;

// The sounds the day-1 probes settled on (docs/plan/probes): they gave "a real song".
const BASE_STYLES = ["2020s indie folk", "stomp-clap acoustic anthem", "warm nostalgic summer road trip", "male lead vocals", "G major", "100 BPM"];
const AVOID_STYLES = ["metal", "screaming", "autotune", "EDM", "lo-fi hiss"];
const INTRO_STYLES = [...BASE_STYLES, "fingerpicked acoustic guitar", "kick drum stomps", "handclaps", "instrumental intro"];
const VERSE_STYLES = ["intimate verse", "clear male vocals", "storytelling delivery", "fingerpicked acoustic guitar", "soft stomps", "builds toward the chorus"];
const VERSE_AVOID = ["rushed phrasing", "spoken word"];
const HOOK_STYLES = ["catchy hook", "group gang vocals", "full band", "strummed acoustic", "stomp-clap"];
const CHORUS_STYLES = ["big sing-along chorus", "group gang vocals", "full band", "strummed acoustic", "stomp-clap", "anthemic lift"];

/** A verse before the song exists: its lines have no windows yet. */
interface PlannedVerse extends TimeWindow {
  readonly kind: "verse";
  readonly friend: string;
  readonly lines: readonly string[];
}

/** A section of the plan, before the song exists. */
type PlannedSection = IntroSection | PlannedVerse | HookSection | ChorusSection;

/** What to ask Eleven Music for, and where each section will land in the song it returns. */
export interface OdePlan {
  /** The composition: one chunk per section, in song order. */
  readonly chunks: readonly ChunkPlan[];
  readonly sections: readonly PlannedSection[];
}

/**
 * Lay out the Ode: an intro, then each friend's verse followed by the hook, then the chorus.
 * Every verse is one chunk (ADR 0001). Section windows come from the planned chunk lengths,
 * which Eleven Music honours, so they are exact before any audio exists.
 *
 * @param lyrics - The lyrics the payer approved.
 * @returns The chunks to compose and the sections they make up.
 */
export function planOde(lyrics: Lyrics): OdePlan {
  const chunks: ChunkPlan[] = [];
  const sections: PlannedSection[] = [];
  let cursor = 0;

  function place(chunk: ChunkPlan, section: (window: TimeWindow) => PlannedSection): void {
    chunks.push(chunk);
    sections.push(section({ startMs: cursor, endMs: cursor + chunk.durationMs }));
    cursor += chunk.durationMs;
  }

  place(
    { text: "[Intro]", styles: INTRO_STYLES, avoidStyles: AVOID_STYLES, durationMs: INTRO_MS },
    (window) => ({ kind: "intro", ...window }),
  );
  for (const [index, verse] of lyrics.verses.entries()) {
    const lines = verse.lines.map((line) => line.text);
    place(
      { text: `[Verse ${index + 1}]\n${lines.join("\n")}`, styles: VERSE_STYLES, avoidStyles: VERSE_AVOID, durationMs: VERSE_MS },
      (window) => ({ kind: "verse", friend: verse.friend, lines, ...window }),
    );
    place(
      { text: `[Hook]\n${lyrics.hook.text}`, styles: HOOK_STYLES, avoidStyles: AVOID_STYLES, durationMs: HOOK_MS },
      (window) => ({ kind: "hook", text: lyrics.hook.text, ...window }),
    );
  }
  place(
    { text: `[Chorus]\n${lyrics.chorus.text}`, styles: CHORUS_STYLES, avoidStyles: AVOID_STYLES, durationMs: CHORUS_MS },
    (window) => ({ kind: "chorus", text: lyrics.chorus.text, ...window }),
  );
  return { chunks, sections };
}

/** The sung words do not line up with the lyrics well enough to find where each line is sung. */
export class AlignmentFailed extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "AlignmentFailed" as const;

  /** @param reason - What did not line up, for the operator's log. */
  constructor(reason: string) {
    super(`Could not find the lines in the sung words: ${reason}`);
  }
}

/** Letters and digits only, lowercase: "Cupholder," as sung and "cupholder" as written are the same word. */
function normalize(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

interface LyricWord {
  readonly line: number;
  readonly token: string;
}

interface SungWord {
  readonly token: string;
  readonly timing: WordTiming;
}

/** Pair lyric words with sung words that are the same word, in order, as many as possible (longest common subsequence). */
function matchWords(lyric: readonly LyricWord[], sung: readonly SungWord[]): [LyricWord, SungWord][] {
  const memo = new Map<number, number>();
  /** How many words the rest of the lyric, from `i`, shares in order with the rest of the sung words, from `j`. */
  const shared = (i: number, j: number): number => {
    if (i >= lyric.length || j >= sung.length) return 0;
    const key = i * (sung.length + 1) + j;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const value =
      lyric[i]?.token === sung[j]?.token ? 1 + shared(i + 1, j + 1) : Math.max(shared(i + 1, j), shared(i, j + 1));
    memo.set(key, value);
    return value;
  };

  const pairs: [LyricWord, SungWord][] = [];
  for (let i = 0, j = 0; i < lyric.length && j < sung.length; ) {
    const wanted = lyric[i];
    const heard = sung[j];
    if (wanted === undefined || heard === undefined) break;
    if (wanted.token === heard.token) {
      pairs.push([wanted, heard]);
      i++;
      j++;
    } else if (shared(i + 1, j) >= shared(i, j + 1)) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** Cut a window into one stretch per line at the given cuts; the last line runs to the window's end. */
function tile(window: TimeWindow, lines: readonly string[], cuts: readonly number[]): TimedLine[] {
  let startMs = window.startMs;
  return lines.map((text, index) => {
    const endMs = cuts[index] ?? window.endMs;
    const line = { text, startMs, endMs };
    startMs = endMs;
    return line;
  });
}

/**
 * Find where each line of a verse is sung by matching the sung words to the lyric words.
 * Each line's window ends halfway through the pause before the next line, so the windows tile
 * the verse window exactly. Fails, rather than guessing, unless every line has at least half
 * of its words found, in order, inside the verse window.
 *
 * @param window - The verse's window in the song.
 * @param lines - The verse's lyric lines.
 * @param words - Every sung word in the song, in song order.
 * @returns One timed line per lyric line, or why the words do not line up.
 */
function alignLines(
  window: TimeWindow,
  lines: readonly string[],
  words: readonly WordTiming[],
): Result<readonly TimedLine[], AlignmentFailed> {
  const lyric = lines.flatMap((text, line) =>
    text
      .split(/\s+/)
      .map(normalize)
      .filter((token) => token !== "")
      .map((token): LyricWord => ({ line, token })),
  );
  const sung = words
    .filter((word) => word.startMs >= window.startMs && word.startMs < window.endMs)
    .map((timing): SungWord => ({ token: normalize(timing.text), timing }))
    .filter(({ token }) => token !== "");
  const matches = matchWords(lyric, sung);

  let previousStart = window.startMs;
  for (const [, { timing }] of matches) {
    if (timing.startMs < previousStart) return err(new AlignmentFailed("the sung words are out of order in time"));
    previousStart = timing.startMs;
  }

  const cuts: number[] = [];
  let previousEnd: number | undefined;
  for (const [line] of lines.entries()) {
    const heard = matches.filter(([wanted]) => wanted.line === line).map(([, { timing }]) => timing);
    const first = heard[0];
    const last = heard.at(-1);
    const needed = Math.ceil(lyric.filter((wanted) => wanted.line === line).length / 2);
    if (first === undefined || last === undefined || heard.length < needed) {
      return err(new AlignmentFailed(`line ${line + 1} was not sung as written`));
    }
    if (previousEnd !== undefined) cuts.push(Math.floor((previousEnd + first.startMs) / 2));
    previousEnd = last.endMs;
  }

  const inOrder = cuts.every((cut, index) => cut > (cuts[index - 1] ?? window.startMs) && cut < window.endMs);
  if (!inOrder) return err(new AlignmentFailed("the lines are not sung in order inside the verse"));
  return ok(tile(window, lines, cuts));
}

/** A verse whose line windows are equal quarters because the sung words did not line up. */
export interface UnalignedVerse {
  readonly friend: string;
  readonly reason: AlignmentFailed;
}

/** The Ode, and the verses that had to fall back to equal quarters. */
export interface BuiltOde {
  readonly ode: Ode;
  readonly unaligned: readonly UnalignedVerse[];
}

/**
 * Turn a plan and the sung words into the Ode. A verse whose words do not line up with its
 * lyrics is split into equal quarters instead (ADR 0001); the verse window itself stays exact.
 *
 * @param plan - The plan that was composed.
 * @param words - Every sung word in the song, in song order.
 * @returns The Ode, and which verses fell back to equal quarters.
 */
export function buildOde(plan: OdePlan, words: readonly WordTiming[]): BuiltOde {
  const unaligned: UnalignedVerse[] = [];
  const sections = plan.sections.map((section): Section => {
    if (section.kind !== "verse") return section;
    const aligned = alignLines(section, section.lines, words);
    if (aligned._tag === "err") unaligned.push({ friend: section.friend, reason: aligned.error });
    const lines = aligned._tag === "ok" ? aligned.value : tile(section, section.lines, equalCuts(section, section.lines.length));
    return { kind: "verse", friend: section.friend, startMs: section.startMs, endMs: section.endMs, lines };
  });
  return { ode: makeOde(sections), unaligned };
}

/** The cuts that split a window into equal parts, one part per line. */
function equalCuts(window: TimeWindow, parts: number): number[] {
  return Array.from({ length: parts - 1 }, (_, index) =>
    window.startMs + Math.floor(((index + 1) * (window.endMs - window.startMs)) / parts),
  );
}
