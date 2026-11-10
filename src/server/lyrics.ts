import { BRAND_NAMES, SONG_TITLES } from "./blocklist.ts";
import { rowWarnings, type Ledger } from "./ledger.ts";
import { err, ok, type Result } from "./result.ts";

/** Lines in one friend's verse; each stands for 25% of what they are owed. */
export const LINES_PER_VERSE = 4;

/** Longest lyric line, in characters: what one line can sing in its share of a verse. */
export const MAX_LINE_LENGTH = 200;

/** Which line of a verse, counting from 1. */
export type LineNumber = 1 | 2 | 3 | 4;

/** One place in the lyrics that holds a line of text. */
export type LineSlot =
  | { readonly _tag: "verse"; readonly friend: string; readonly line: LineNumber }
  | { readonly _tag: "hook" }
  | { readonly _tag: "chorus" };

/** One sung line. `text` is at most `MAX_LINE_LENGTH` characters; `problems` is empty when it passes the checks. */
export interface LyricLine {
  readonly text: string;
  readonly problems: readonly string[];
}

/** One friend's four lines, in order. */
export interface Verse {
  readonly friend: string;
  readonly lines: readonly LyricLine[];
}

/** The song's words: a verse per friend in ledger order, the hook between verses, and the final chorus. */
export interface Lyrics {
  readonly verses: readonly Verse[];
  readonly hook: LyricLine;
  readonly chorus: LyricLine;
}

/** A friend the lyrics are built around. */
export interface LyricFriend {
  readonly name: string;
  readonly insideJoke: string;
}

/** What Claude wrote before the checks: raw text per slot. */
export interface WrittenLyrics {
  readonly verses: readonly { readonly friend: LyricFriend; readonly lines: readonly string[] }[];
  readonly hook: string;
  readonly chorus: string;
}

/** The ledger is not ready to write lyrics from. */
export class LedgerNotReady extends Error {
  readonly _tag = "LedgerNotReady" as const;
}

/** Some lyric lines are flagged, so the Ode must not be composed from them. */
export class LyricsFlagged extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "LyricsFlagged" as const;

  /** The flagged lines, in song order. */
  readonly slots: readonly LineSlot[];

  /** @param slots - The flagged lines, in song order; the message names each for the payer. */
  constructor(slots: readonly LineSlot[]) {
    super(`Fix the flagged lines in the lyrics before making the Ode: ${slots.map(describeSlot).join(", ")}.`);
    this.slots = slots;
  }
}

function describeSlot(slot: LineSlot): string {
  switch (slot._tag) {
    case "verse":
      return `${slot.friend}'s line ${slot.line}`;
    case "hook":
      return "the hook";
    case "chorus":
      return "the chorus";
  }
}

/**
 * Check that no line is flagged: the Ode never sings an amount, a brand or a song title.
 *
 * @param lyrics - The saved lyrics.
 * @returns The lyrics, or `LyricsFlagged` naming every flagged line.
 */
export function requireUnflagged(lyrics: Lyrics): Result<Lyrics, LyricsFlagged> {
  const flagged: LineSlot[] = [];
  for (const verse of lyrics.verses) {
    verse.lines.forEach((line, index) => {
      // SAFETY: a verse has LINES_PER_VERSE lines, so index + 1 is 1 to 4.
      if (line.problems.length > 0) flagged.push({ _tag: "verse", friend: verse.friend, line: (index + 1) as LineNumber });
    });
  }
  if (lyrics.hook.problems.length > 0) flagged.push({ _tag: "hook" });
  if (lyrics.chorus.problems.length > 0) flagged.push({ _tag: "chorus" });
  return flagged.length === 0 ? ok(lyrics) : err(new LyricsFlagged(flagged));
}

/** Claude's lyrics did not have the shape the schema promised. */
export class MalformedLyrics extends Error {
  readonly _tag = "MalformedLyrics" as const;

  constructor(detail: string) {
    super(`Claude's lyrics were malformed: ${detail}`);
  }
}

/**
 * Check that the saved ledger can be sung about: at least one friend, each with an amount and an inside joke.
 *
 * @param ledger - The saved ledger.
 * @returns The friends in ledger order, or `LedgerNotReady` saying what to fix.
 */
export function lyricFriends(ledger: Ledger): Result<readonly LyricFriend[], LedgerNotReady> {
  if (ledger.rows.length === 0) {
    return err(new LedgerNotReady("Build the ledger first: no friends are on it yet."));
  }
  // A proposed (estimated) amount does not block; a missing or covered amount, or a missing joke, does.
  const fixes = ledger.rows
    .filter((row) => row.amountOwedCents === null || row.insideJoke === "")
    .flatMap((row) => rowWarnings(row));
  if (fixes.length > 0) return err(new LedgerNotReady(`Fix the ledger before writing lyrics. ${fixes.join(" ")}`));
  return ok(ledger.rows.map((row) => ({ name: row.friend, insideJoke: row.insideJoke })));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trimmed text, or undefined when the value is not text or is blank. */
function parseNonBlank(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? undefined : text;
}

/**
 * Parse Claude's reply into raw lyrics for exactly the given friends.
 *
 * @param raw - The structured output exactly as Claude returned it.
 * @param friends - The friends the lyrics were requested for.
 * @returns The lyrics in `friends` order, or `MalformedLyrics` naming the first problem found.
 */
export function parseWrittenLyrics(raw: unknown, friends: readonly LyricFriend[]): Result<WrittenLyrics, MalformedLyrics> {
  const versesRaw = isRecord(raw) && Array.isArray(raw["friends"]) ? raw["friends"] : undefined;
  const hook = parseNonBlank(isRecord(raw) ? raw["hook"] : undefined);
  const chorus = parseNonBlank(isRecord(raw) ? raw["chorus"] : undefined);
  if (versesRaw === undefined || hook === undefined || chorus === undefined) {
    return err(new MalformedLyrics("expected friends, a hook and a chorus"));
  }

  const linesByFriend = new Map<string, readonly string[]>();
  for (const item of versesRaw) {
    const name = parseNonBlank(isRecord(item) ? item["name"] : undefined);
    const lines = isRecord(item) && Array.isArray(item["lines"]) ? item["lines"].map(parseNonBlank) : undefined;
    if (name === undefined || lines === undefined) return err(new MalformedLyrics("a verse has no name or lines"));
    if (lines.length !== LINES_PER_VERSE) {
      return err(new MalformedLyrics(`${name} has ${lines.length} lines, not ${LINES_PER_VERSE}`));
    }
    const texts: string[] = [];
    for (const line of lines) {
      if (line === undefined) return err(new MalformedLyrics(`${name} has a line that is blank or not text`));
      texts.push(line);
    }
    if (linesByFriend.has(name.toLowerCase())) return err(new MalformedLyrics(`${name} appears twice`));
    linesByFriend.set(name.toLowerCase(), texts);
  }

  const verses: { friend: LyricFriend; lines: readonly string[] }[] = [];
  for (const friend of friends) {
    const lines = linesByFriend.get(friend.name.toLowerCase());
    if (lines === undefined) return err(new MalformedLyrics(`no verse for ${friend.name}`));
    verses.push({ friend, lines });
  }
  return ok({ verses, hook, chorus });
}

/**
 * Read the replacement line out of Claude's reply to a rewrite request.
 *
 * @param raw - The structured output exactly as Claude returned it.
 * @returns The replacement text, or undefined when the reply holds no usable line.
 */
export function rewrittenLine(raw: unknown): string | undefined {
  return parseNonBlank(isRecord(raw) ? raw["line"] : undefined);
}

// A currency symbol, a digit (any number could be an amount) or a money word; captures the whole token.
const AMOUNT = /\S*[$€£¥₹\d]\S*|\b(?:dollars?|bucks?|cents?|usd|euros?|rupees?|quid|pesos?)\b/i;

/** Lowercase words only: apostrophes vanish, other punctuation becomes a space. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A whole-word matcher for a name, tolerating a plural or possessive "s". */
function nameMatcher(name: string): { name: string; pattern: RegExp } {
  return { name, pattern: new RegExp(`(?:^| )${normalize(name)}s?(?: |$)`) };
}

const brandMatchers = BRAND_NAMES.map(nameMatcher);
const songMatchers = SONG_TITLES.map(nameMatcher);

/**
 * Run the deterministic checks on one line.
 *
 * A line must not mention an amount (a currency symbol, a money word or any digit; number
 * words with no money word, like "ninety-seven fifty", are not caught), name a brand from
 * the blocklist, or name a song title from the blocklist.
 *
 * @param text - The raw line.
 * @returns What is wrong with the line, for the payer; empty when it passes.
 */
function checkLine(text: string): readonly string[] {
  const problems: string[] = [];
  const amount = AMOUNT.exec(text);
  if (amount !== null) problems.push(`Mentions an amount ("${amount[0]}"). Sing a memory instead.`);
  const words = normalize(text);
  const brand = brandMatchers.find((matcher) => matcher.pattern.test(words));
  if (brand !== undefined) problems.push(`Names a brand ("${brand.name}"). Use a plain word instead.`);
  const song = songMatchers.find((matcher) => matcher.pattern.test(words));
  if (song !== undefined) problems.push(`Names a song ("${song.name}"). Don't name or quote real songs.`);
  return problems;
}

/**
 * Build a line from text, running the checks. A line over `MAX_LINE_LENGTH` is cut and
 * flagged, since the cut may land mid-word; the payer's next save of the line clears that flag.
 *
 * @param text - The raw line.
 * @returns The line, cut to `MAX_LINE_LENGTH`, with the problems found in the text it keeps.
 */
export function makeLine(text: string): LyricLine {
  if (text.length <= MAX_LINE_LENGTH) return { text, problems: checkLine(text) };
  const kept = text.slice(0, MAX_LINE_LENGTH).trimEnd();
  return {
    text: kept,
    problems: [
      `Was ${text.length} characters, over the ${MAX_LINE_LENGTH} limit, so it was cut. Check how it ends.`,
      ...checkLine(kept),
    ],
  };
}

/** The submitted line cannot replace a lyric line. */
export class InvalidLineEdit extends Error {
  readonly _tag = "InvalidLineEdit" as const;
}

/** The edit names a line that is not in the lyrics. */
export class NoSuchLine extends Error {
  readonly _tag = "NoSuchLine" as const;

  constructor() {
    super("There is no such line in the lyrics.");
  }
}

/**
 * Parse an untrusted line edit. Length is a hard limit here: a line over `MAX_LINE_LENGTH`
 * cannot be sung in its share of the verse. Amounts, brands and titles are not refused;
 * they come back as problems on the saved line, so the payer stays in charge of the words.
 *
 * @param input - The request body.
 * @returns The trimmed text, or `InvalidLineEdit` with a message for the payer.
 */
export function parseLineEdit(input: unknown): Result<string, InvalidLineEdit> {
  const text = isRecord(input) && typeof input["text"] === "string" ? input["text"].trim() : "";
  if (text === "") return err(new InvalidLineEdit("Send the new line as text."));
  if (text.length > MAX_LINE_LENGTH) {
    return err(new InvalidLineEdit(`A line can be at most ${MAX_LINE_LENGTH} characters; this one has ${text.length}.`));
  }
  return ok(text);
}

/**
 * Parse the line number in an edit's path.
 *
 * @param input - The path segment.
 * @returns 1 to 4, or `NoSuchLine` when it is not a line of a verse.
 */
export function parseLineNumber(input: string): Result<LineNumber, NoSuchLine> {
  switch (input) {
    case "1":
      return ok(1);
    case "2":
      return ok(2);
    case "3":
      return ok(3);
    case "4":
      return ok(4);
    default:
      return err(new NoSuchLine());
  }
}
