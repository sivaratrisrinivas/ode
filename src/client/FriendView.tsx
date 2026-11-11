import { useEffect, useState, type ReactElement } from "react";
import { Cassette, type ReadyOde, type Section, type VerseSection } from "./Cassette.tsx";
import { failureMessage, UNREACHABLE } from "./messages.tsx";

/** What a friend's page is told about their own money. */
interface You {
  amountOwedCents: number;
  amountRepaidCents: number;
  linesUnlocked: number;
  nextLineAtCents: number | null;
}

/** A verse on a friend's page: only the viewing friend's verse carries amounts. */
type FriendVerse = Omit<VerseSection, "payment" | "friendViewPath"> & { payment: You | null };

type FriendOde =
  | { status: "none" }
  | { status: "making"; steps: { name: string; state: string }[] }
  | { status: "failed"; error: string }
  | { status: "ready"; durationMs: number; audioUrl: string; trip: string; dropped: boolean; sections: (Exclude<Section, VerseSection> | FriendVerse)[] };

/** What `GET /api/friends/:token` and each `state` event carry. */
interface FriendViewState {
  friend: string;
  you: You | null;
  /** The server's word that the friend has a line unlocked and so may share their verse. */
  canShare: boolean;
  ode: FriendOde;
}

/** `ode` is what the cassette plays, made once per event so the cassette sees a new Ode only when the server sent one. */
type Load = { status: "loading" } | { status: "gone" } | { status: "ready"; view: FriendViewState; ode: ReadyOde | null };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The Ode for the Cassette: the amounts on the viewing friend's verse are shown above it, not inside it. */
function playable(ode: FriendOde): ReadyOde | null {
  if (ode.status !== "ready") return null;
  return {
    durationMs: ode.durationMs,
    audioUrl: ode.audioUrl,
    trip: ode.trip,
    dropped: ode.dropped,
    sections: ode.sections.map((section) => (section.kind === "verse" ? { ...section, payment: null } : section)),
  };
}

/** The share button and, once pressed, the link to post: the server makes the share from what is unlocked right now. */
function ShareVerse({ token, friend }: { token: string; friend: string }): ReactElement {
  const [link, setLink] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function share() {
    setProblem(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/friends/${encodeURIComponent(token)}/share`, { method: "POST" });
      if (!res.ok) return setProblem(await failureMessage(res));
      const made: { sharePath: string } = await res.json();
      const url = `${location.origin}${made.sharePath}`;
      setLink(url);
      // Where the device has a share sheet, offer it; the link stays on the page either way.
      if (typeof navigator.share === "function") await navigator.share({ title: `An Ode for ${friend}`, url }).catch(() => undefined);
    } catch {
      setProblem(UNREACHABLE);
    }
  }

  async function copy() {
    if (link === null) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the link is selectable in the field.
    }
  }

  return (
    <section aria-label="Share your verse">
      <button onClick={() => void share()}>Share my verse</button>
      {problem !== null && <p role="alert" style={{ color: "#b00020" }}>{problem}</p>}
      {link !== null && (
        <p>
          <input readOnly aria-label="Your share link" value={link} onFocus={(event) => event.currentTarget.select()} style={{ width: "70%" }} />{" "}
          <button onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>{" "}
          <a href={link}>Open</a>
        </p>
      )}
    </section>
  );
}

/**
 * A friend's private page: the whole Ode with locked lines muffled and blurred, and only this friend's own amounts. It
 * follows the server's event stream, so a payment to this friend unlocks their line while the page is open. After a
 * drop the browser reconnects by itself and the stream starts again with the whole current state.
 *
 * @param props - The friend's link token, from the page's address.
 */
export function FriendView({ token }: { token: string }): ReactElement {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const events = new EventSource(`/api/friends/${encodeURIComponent(token)}/events`);
    events.addEventListener("state", (event) => {
      const view: FriendViewState = JSON.parse(event.data);
      setReconnecting(false);
      setLoad({ status: "ready", view, ode: playable(view.ode) });
    });
    events.onerror = () => {
      // The browser retries a dropped stream by itself. A stream it has closed for good was refused (the link no longer
      // belongs to anyone), and what was on the page is no longer the friend's to see.
      if (events.readyState === EventSource.CLOSED) setLoad({ status: "gone" });
      else setReconnecting(true);
    };
    return () => events.close();
  }, [token]);

  const main = { fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "3rem auto", padding: "0 1rem" } as const;

  if (load.status === "loading") return <main style={main}><p>Loading…</p></main>;
  if (load.status === "gone") {
    return (
      <main style={main}>
        <h1>Ode</h1>
        <p>This link doesn’t work any more. Ask for a new one.</p>
      </main>
    );
  }

  const { friend, you } = load.view;
  return (
    <main style={main}>
      <h1>An Ode for {friend}</h1>
      {reconnecting && <p aria-live="polite">Reconnecting…</p>}
      {you !== null && (
        <section aria-label="Your money">
          <p>
            Owed to you: <strong>{dollars(you.amountOwedCents)}</strong> · Repaid so far: <strong>{dollars(you.amountRepaidCents)}</strong>
            {you.nextLineAtCents !== null && <> · Next line unlocks at {dollars(you.nextLineAtCents)} repaid</>}
          </p>
        </section>
      )}
      {load.view.canShare && <ShareVerse token={token} friend={friend} />}
      {load.ode !== null ? (
        <Cassette ode={load.ode} title="The Ode" />
      ) : (
        <p>{load.view.ode.status === "making" ? "The Ode is being made…" : "The Ode isn’t ready yet."}</p>
      )}
    </main>
  );
}
