import type { Section, VerseSection } from "./ode.ts";
import type { FriendStanding } from "./payments.ts";
import { err, ok, type Result } from "./result.ts";
import { withChorusLock } from "./unlock.ts";

/** The link token belongs to nobody: it was never given out, or the ledger it was made for has been replaced. */
export class UnknownLink extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "UnknownLink" as const;

  constructor() {
    super("This link doesn't belong to anyone.");
  }
}

/**
 * Turn a store's answer to "whose link is this" into a value.
 *
 * @param friend - The friend the token belongs to, or undefined when it belongs to nobody.
 */
export function linkOwner(friend: string | undefined): Result<string, UnknownLink> {
  return friend === undefined ? err(new UnknownLink()) : ok(friend);
}

/** How often an open friend view looks for a change. Under a second, so an unlock reaches the view within the second. */
export const EVENT_POLL_MS = 250;

/** How long a stream may be silent before it sends a comment, so a proxy does not close it as idle. */
const KEEPALIVE_MS = 15_000;

/**
 * The page a friend's private link opens.
 *
 * @param token - The friend's link token; undefined when the friend has none.
 * @returns The page path, or null without a token.
 */
export function friendViewPath(token: string | undefined): string | null {
  return token === undefined ? null : `/f/${token}`;
}

/** What a friend is told about their own money: nobody else's, and nothing about paying. */
function youJson({ amountOwedCents, amountRepaidCents, linesUnlocked, nextLineAtCents }: FriendStanding) {
  return { amountOwedCents, amountRepaidCents, linesUnlocked, nextLineAtCents };
}

/** A verse's lines, each locked or not: the first `linesUnlocked` of the friend's standing are clear. A friend with no standing has every line locked. */
function withLocks<Line extends object>(lines: readonly Line[], standing: FriendStanding | undefined) {
  return lines.map((line, index) => ({ ...line, locked: index >= (standing?.linesUnlocked ?? 0) }));
}

/**
 * The Ode's sections with their locks: every verse with each of its lines locked or not, the chorus locked or dropped,
 * and whatever else a reader sees on a verse. The one place the payer's page and a friend's page decide what is
 * locked, so they cannot disagree and a new kind of locked section is added once.
 *
 * @param sections - The Ode's sections, in song order.
 * @param standings - Every friend's standing.
 * @param verseExtras - What a reader adds to each verse (an amount, a link) given the friend's standing, which is undefined for a friend with none.
 */
export function lockedSections(
  sections: readonly Section[],
  standings: readonly FriendStanding[],
  verseExtras: (verse: VerseSection, standing: FriendStanding | undefined) => object,
) {
  return sections.map((section) => {
    if (section.kind === "chorus") return withChorusLock(section, standings);
    if (section.kind !== "verse") return section;
    const standing = standings.find((candidate) => candidate.friend === section.friend);
    return { ...section, lines: withLocks(section.lines, standing), ...verseExtras(section, standing) };
  });
}

/** The Ode's sections for one friend: amounts only on the viewing friend's own verse. */
function friendSectionsJson(sections: readonly Section[], standings: readonly FriendStanding[], viewer: string) {
  return lockedSections(sections, standings, (verse, standing) => ({
    payment: standing !== undefined && verse.friend === viewer ? youJson(standing) : null,
  }));
}

/**
 * A friend's whole page as JSON: who they are, their own amounts, and the Ode with every friend's lines locked or
 * unlocked. Nothing in it carries another friend's amounts or link.
 *
 * @param friend - The friend the link belongs to.
 * @param standings - Every friend's standing; only `friend`'s reaches the result.
 * @param ode - Renders the Ode's status given how to show a ready Ode's sections.
 */
export function friendViewJson(
  friend: string,
  standings: readonly FriendStanding[],
  ode: (sections: (sections: readonly Section[]) => unknown) => unknown,
) {
  const own = standings.find((candidate) => candidate.friend === friend);
  return {
    friend,
    you: own === undefined ? null : youJson(own),
    ode: ode((sections) => friendSectionsJson(sections, standings, friend)),
  };
}

/**
 * A server-sent event stream of one value: it sends `first` at once and the value again, as `event: state`, each time
 * it changes. The value is looked for by polling `read`, so a change made by any web service process reaches every
 * open stream. The stream ends when the reader leaves, when `read` says the link is gone, and when `read` fails; an
 * `EventSource` reconnects after a drop and is sent the whole state again.
 *
 * @param first - The value to send on connect.
 * @param read - Reads the current value, or says the link no longer belongs to anyone.
 */
export function eventStream(first: unknown, read: () => Promise<Result<unknown, UnknownLink>>): Response {
  const encoder = new TextEncoder();
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let last = JSON.stringify(first);
      let quietSince = Date.now();
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      send(`event: state\ndata: ${last}\n\n`);

      function end() {
        ended = true;
        controller.close();
      }

      async function poll() {
        if (ended) return;
        try {
          const current = await read();
          // The reader may have left while `read` ran.
          if (ended) return;
          if (current._tag === "err") return end();
          const data = JSON.stringify(current.value);
          if (data !== last) {
            last = data;
            quietSince = Date.now();
            send(`event: state\ndata: ${data}\n\n`);
          } else if (Date.now() - quietSince >= KEEPALIVE_MS) {
            quietSince = Date.now();
            send(": keepalive\n\n");
          }
        } catch (error) {
          // A read that fails ends the stream; the page's EventSource reconnects and gets the whole state again.
          console.error("reading a friend view for its event stream failed:", error);
          return end();
        }
        timer = setTimeout(() => void poll(), EVENT_POLL_MS);
      }

      timer = setTimeout(() => void poll(), EVENT_POLL_MS);
    },
    cancel() {
      ended = true;
      clearTimeout(timer);
    },
  });

  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" },
  });
}
