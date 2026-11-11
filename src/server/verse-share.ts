import type { Ode, TimeWindow } from "./ode.ts";
import type { Owner } from "./owner.ts";
import type { FriendStanding } from "./payments.ts";
import { err, ok, type Result } from "./result.ts";

/** The friend has no unlocked line, so there is no verse to share yet. */
export class NoUnlockedLines extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "NoUnlockedLines" as const;

  constructor() {
    super("Unlock at least one of your lines before sharing your verse.");
  }
}

/** The Ode is not made (or the friend has no verse in it), so there is nothing to cut a verse share from. */
export class NoOdeToShare extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "NoOdeToShare" as const;

  constructor() {
    super("The Ode isn't ready yet, so there is nothing to share.");
  }
}

/** The share link belongs to nobody: it was never made, or the ledger it was made for has been replaced. */
export class UnknownShare extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "UnknownShare" as const;

  constructor() {
    super("This share link doesn't belong to anything.");
  }
}

/** What a verse share holds, fixed when the friend makes it: how much of the friend's verse and whether the chorus was in. */
export interface ShareRecord {
  /** Whose Ode the share is cut from: the Seeded Ode, or a judge's own. */
  readonly owner: Owner;
  readonly friend: string;
  /** The first this many of the friend's lines are in the share; at least 1. */
  readonly linesUnlocked: number;
  /** Whether the chorus had dropped when the share was made. */
  readonly withChorus: boolean;
}

/**
 * Whether a friend may share: only when at least one of their lines is unlocked. The one place that is decided, so the
 * friend's page (the button) and the share request cannot disagree.
 *
 * @param standing - The friend's standing; undefined for a friend with no amount owed, who has nothing unlocked.
 * @returns Whether they may; true also tells the compiler there is a standing.
 */
export function canShareVerse(standing: Pick<FriendStanding, "linesUnlocked"> | undefined): standing is Pick<FriendStanding, "linesUnlocked"> {
  return standing !== undefined && standing.linesUnlocked >= 1;
}

/**
 * What a friend's verse share holds right now.
 *
 * @param holder - The friend and the Ode whose link was used.
 * @param standing - The friend's standing; undefined for a friend with nothing owed.
 * @param chorusHasDropped - Whether every friend is repaid.
 * @returns The record to keep, or `NoUnlockedLines`.
 */
export function shareRecordFor(
  holder: { readonly owner: Owner; readonly friend: string },
  standing: Pick<FriendStanding, "linesUnlocked"> | undefined,
  chorusHasDropped: boolean,
): Result<ShareRecord, NoUnlockedLines> {
  if (!canShareVerse(standing)) return err(new NoUnlockedLines());
  return ok({ owner: holder.owner, friend: holder.friend, linesUnlocked: standing.linesUnlocked, withChorus: chorusHasDropped });
}

/**
 * The line that names a verse share: "An Ode for [name]". The one place it is written; the share's preview card headlines with
 * it and `shareTitle` adds the trip.
 *
 * @param friend - Whose verse it is.
 */
export function shareHeadline(friend: string): string {
  return `An Ode for ${friend}`;
}

/**
 * What a verse share is called wherever it is shown or previewed: the page, the chat preview and the device's share sheet.
 *
 * @param friend - Whose verse it is.
 * @param trip - What the trip is called.
 */
export function shareTitle(friend: string, trip: string): string {
  return `${shareHeadline(friend)} · ${trip}`;
}

/** How long two stretches overlap where a verse share jumps from one to the next, so the join is not a click. */
export const CROSSFADE_MS = 250;

/** One part of a verse share as the share page lists it: only what the friend may show. */
export type ShareSection =
  | { readonly kind: "intro" }
  | { readonly kind: "verse"; readonly friend: string; readonly lines: readonly string[] }
  | { readonly kind: "hook"; readonly text: string }
  | { readonly kind: "chorus"; readonly text: string };

/** A verse share: what it shows and which stretches of the Ode's audio it plays, in order. */
export interface VerseShare {
  readonly friend: string;
  readonly sections: readonly ShareSection[];
  /** Stretches of the Ode, in song order. Parts that sit next to each other in the Ode are one stretch, so a share with no gaps has no seams. */
  readonly stretches: readonly TimeWindow[];
}

/**
 * Cut a verse share from the Ode: the intro, the friend's first `linesUnlocked` lines, the hook that follows their verse, and
 * the chorus when `withChorus`. Nothing else is in it, so another friend's verse and the friend's own locked lines are not
 * in what it shows or plays.
 *
 * @param ode - The Ode.
 * @param record - Whose share this is and how much of the verse it holds.
 * @returns The share, or `NoOdeToShare` when the friend has no verse in the Ode.
 */
export function buildVerseShare(ode: Ode, record: ShareRecord): Result<VerseShare, NoOdeToShare> {
  const verseAt = ode.sections.findIndex((section) => section.kind === "verse" && section.friend === record.friend);
  const verse = ode.sections[verseAt];
  if (verse?.kind !== "verse") return err(new NoOdeToShare());

  const lines = verse.lines.slice(0, record.linesUnlocked);
  const hook = ode.sections.slice(verseAt + 1).find((section) => section.kind === "hook");
  const intro = ode.sections.find((section) => section.kind === "intro");
  const chorus = ode.sections.find((section) => section.kind === "chorus");

  const sections: ShareSection[] = [];
  const windows: TimeWindow[] = [];
  const add = (shown: ShareSection, window: TimeWindow) => {
    sections.push(shown);
    windows.push(window);
  };
  const first = lines[0];
  const last = lines.at(-1);
  if (intro !== undefined) add({ kind: "intro" }, intro);
  if (first !== undefined && last !== undefined) {
    add({ kind: "verse", friend: record.friend, lines: lines.map((line) => line.text) }, { startMs: first.startMs, endMs: last.endMs });
  }
  if (hook?.kind === "hook") add({ kind: "hook", text: hook.text }, hook);
  if (record.withChorus && chorus?.kind === "chorus") add({ kind: "chorus", text: chorus.text }, chorus);

  return ok({ friend: record.friend, sections, stretches: joinNeighbours(windows) });
}

/** Windows in song order with each one that starts where the one before ends joined to it. */
function joinNeighbours(windows: readonly TimeWindow[]): TimeWindow[] {
  const joined: TimeWindow[] = [];
  for (const window of windows) {
    const previous = joined.at(-1);
    if (previous !== undefined && previous.endMs === window.startMs) joined[joined.length - 1] = { startMs: previous.startMs, endMs: window.endMs };
    else joined.push(window);
  }
  return joined;
}

/** A stretch of the Ode's audio file, as byte offsets; `end` is exclusive. */
export interface ByteStretch {
  readonly start: number;
  readonly end: number;
}

/**
 * Where each stretch sits in the Ode's audio file. The audio is constant bitrate, so a moment is the same fraction of the
 * way through the file as through the Ode. A cut that falls inside an MP3 frame is dropped by the decoder, which carries on
 * at the next frame.
 *
 * @param stretches - The stretches to play, in Ode time.
 * @param ode - The Ode they are cut from.
 * @param size - The audio file's length in bytes.
 */
export function byteStretches(stretches: readonly TimeWindow[], ode: Pick<Ode, "durationMs">, size: number): ByteStretch[] {
  const at = (ms: number) => Math.min(size, Math.floor((ms * size) / ode.durationMs));
  return stretches.map((stretch) => ({ start: at(stretch.startMs), end: at(stretch.endMs) }));
}

/**
 * The bytes of a verse share's audio: the stretches cut from the Ode's file and joined end to end, so nothing between them (a
 * locked line, another friend's verse) is in it.
 *
 * @param audio - The Ode's whole audio file.
 * @param stretches - Which bytes to keep, in play order, as `byteStretches` made them.
 */
export function clipOf(audio: Uint8Array, stretches: readonly ByteStretch[]): Uint8Array {
  const clip = new Uint8Array(stretches.reduce((sum, stretch) => sum + stretch.end - stretch.start, 0));
  let at = 0;
  for (const stretch of stretches) {
    clip.set(audio.subarray(stretch.start, stretch.end), at);
    at += stretch.end - stretch.start;
  }
  return clip;
}
