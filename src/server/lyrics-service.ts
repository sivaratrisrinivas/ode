import {
  LINES_PER_VERSE,
  lyricFriends,
  makeLine,
  MAX_LINE_LENGTH,
  NoSuchLine,
  parseWrittenLyrics,
  rewrittenLine,
  type LedgerNotReady,
  type LineSlot,
  type LyricFriend,
  type LyricLine,
  type Lyrics,
  type MalformedLyrics,
} from "./lyrics.ts";
import type { LedgerStore } from "./ledger-service.ts";
import type { Claude, ClaudeUnavailable, JsonSchema } from "./ports.ts";
import { err, ok, type Result } from "./result.ts";

/** What the lyrics service needs from storage for the one set of lyrics. */
export interface LyricsStore {
  /** The saved lyrics; undefined when none have been written for the current ledger. */
  read(): Promise<Lyrics | undefined>;
  /** Replace all lyrics atomically. */
  replace(lyrics: Lyrics): Promise<void>;
  /** Write one line; undefined when there are no lyrics or no such slot. */
  updateLine(slot: LineSlot, line: LyricLine): Promise<LyricLine | undefined>;
}

const writeInstructions = `You write the words of a song about a shared trip. The payer made it as a gift for the friends who covered their costs.

You get the friends, each with an inside joke from the trip. Write:
- friends: for each friend, a verse of exactly ${LINES_PER_VERSE} lines built around their inside joke, sung to them with warmth.
- hook: one short refrain line that is sung between the verses.
- chorus: one line about the whole trip that is sung at the very end.

Rules; code checks every line afterwards:
- Each line is at most ${MAX_LINE_LENGTH} characters. Aim for 50 to 80: each verse line is sung in about five seconds.
- Sing memories and affection only. Never mention money, amounts, prices, debt, owing or paying back. Write numbers as words, never digits.
- Replace brand names and products with plain words ("the beach house", "burritos").
- Never name, quote or echo the lyrics of a real song.
- Use only the friends and memories you were given.`;

const lineArray = { type: "array", items: { type: "string" } };

const writeSchema: JsonSchema = {
  type: "object",
  properties: {
    friends: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, lines: lineArray },
        required: ["name", "lines"],
        additionalProperties: false,
      },
    },
    hook: { type: "string" },
    chorus: { type: "string" },
  },
  required: ["friends", "hook", "chorus"],
  additionalProperties: false,
};

const rewriteInstructions = `You fix one line of song lyrics that failed a check. Rewrite it so the listed problems are gone, keeping its meaning, its mood and roughly its length. Reply with only the new line.

The song sings trip memories and affection. A line never mentions money or amounts, never names a brand or product (use a plain word), never names or quotes a real song, uses no digits, and is at most ${MAX_LINE_LENGTH} characters.`;

const rewriteSchema: JsonSchema = {
  type: "object",
  properties: { line: { type: "string" } },
  required: ["line"],
  additionalProperties: false,
};

/** Where a line sits, as Claude needs it to rewrite the line in context. */
type LineContext = { readonly _tag: "verse"; readonly friend: LyricFriend } | { readonly _tag: "hook" } | { readonly _tag: "chorus" };

/**
 * Check a line and, when it fails, ask Claude for one replacement. The replacement is kept
 * whether or not it passes: a line that still fails is flagged for the payer, never retried.
 * When Claude cannot answer, the original stays and is flagged.
 */
async function settle(claude: Claude, context: LineContext, text: string): Promise<LyricLine> {
  const first = makeLine(text);
  if (first.problems.length === 0) return first;

  const reply = await claude.structured({
    task: "rewrite-line",
    instructions: rewriteInstructions,
    schema: rewriteSchema,
    input: JSON.stringify({
      ...(context._tag === "verse"
        ? { part: "verse", friend: context.friend.name, insideJoke: context.friend.insideJoke }
        : { part: context._tag }),
      line: text,
      problems: first.problems,
    }),
  });
  if (reply._tag === "err") console.error("lyric rewrite failed; flagging the original line:", reply.error);
  const replacement = reply._tag === "ok" ? rewrittenLine(reply.value) : undefined;
  return replacement === undefined ? first : makeLine(replacement);
}

/** Why lyrics could not be written from the ledger. */
export type WriteLyricsError = LedgerNotReady | ClaudeUnavailable | MalformedLyrics;

/**
 * Write lyrics from the saved ledger and save them in place of the current ones.
 * Only names and inside jokes go to Claude, never amounts.
 * Nothing is saved when this fails.
 *
 * @param deps - Claude, the ledger store and the lyrics store.
 * @returns The saved lyrics, or why they could not be written.
 */
export async function writeLyrics(
  deps: { claude: Claude; ledger: Pick<LedgerStore, "read">; store: LyricsStore },
): Promise<Result<Lyrics, WriteLyricsError>> {
  const friends = lyricFriends(await deps.ledger.read());
  if (friends._tag === "err") return err(friends.error);

  const reply = await deps.claude.structured({
    task: "write-lyrics",
    instructions: writeInstructions,
    schema: writeSchema,
    input: JSON.stringify({ friends: friends.value }),
  });
  if (reply._tag === "err") return err(reply.error);

  const written = parseWrittenLyrics(reply.value, friends.value);
  if (written._tag === "err") return err(written.error);

  const { claude } = deps;
  const lyrics: Lyrics = {
    verses: await Promise.all(
      written.value.verses.map(async ({ friend, lines }) => ({
        friend: friend.name,
        lines: await Promise.all(lines.map((text) => settle(claude, { _tag: "verse", friend }, text))),
      })),
    ),
    hook: await settle(claude, { _tag: "hook" }, written.value.hook),
    chorus: await settle(claude, { _tag: "chorus" }, written.value.chorus),
  };
  await deps.store.replace(lyrics);
  return ok(lyrics);
}

/**
 * Replace one line with the payer's text and re-run the checks on it.
 *
 * @param store - The lyrics store.
 * @param slot - The line to replace.
 * @param text - The parsed edit.
 * @returns The saved line, with any problems the new text has, or `NoSuchLine`.
 */
export async function editLyricLine(store: LyricsStore, slot: LineSlot, text: string): Promise<Result<LyricLine, NoSuchLine>> {
  const line = await store.updateLine(slot, makeLine(text));
  return line === undefined ? err(new NoSuchLine()) : ok(line);
}
