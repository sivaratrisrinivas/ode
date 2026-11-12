import { useEffect, useState, type ReactElement } from "react";
import { Cassette, type ReadyOde, type Release, type Section, type VerseSection } from "./Cassette.tsx";
import { Brand, Meter } from "./chrome.tsx";
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
  | { status: "ready"; durationMs: number; audioUrl: string; voiceLabel: string | null; trip: string; dropped: boolean; release: Release | null; sections: (Exclude<Section, VerseSection> | FriendVerse)[] };

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
    voiceLabel: ode.voiceLabel,
    trip: ode.trip,
    dropped: ode.dropped,
    release: ode.release,
    sections: ode.sections.map((section) => (section.kind === "verse" ? { ...section, payment: null } : section)),
  };
}

/** The share button and, once pressed, the link to post: the server makes the share from what is unlocked right now. */
function ShareVerse({ token }: { token: string }): ReactElement {
  const [link, setLink] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function share() {
    setProblem(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/friends/${encodeURIComponent(token)}/share`, { method: "POST" });
      if (!res.ok) return setProblem(await failureMessage(res));
      const made: { sharePath: string; title: string } = await res.json();
      const url = `${location.origin}${made.sharePath}`;
      setLink(url);
      // Where the device has a share sheet, offer it; the link stays on the page either way.
      if (typeof navigator.share === "function") await navigator.share({ title: made.title, url }).catch(() => undefined);
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
    <section aria-label="Share your verse" className="ode-share">
      <div className="ode-share-row">
        <button className="primary" onClick={() => void share()}>Share my verse</button>
      </div>
      {problem !== null && <p role="alert" className="ode-problem">{problem}</p>}
      {link !== null && (
        <div className="ode-share-row">
          <input readOnly aria-label="Your share link" value={link} onFocus={(event) => event.currentTarget.select()} />
          <button onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
          <a href={link}>Open</a>
        </div>
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

  if (load.status === "loading") return <main className="ode-page"><p className="ode-loading">Loading…</p></main>;
  if (load.status === "gone") {
    return (
      <main className="ode-page">
        <Brand as="h1" />
        <p className="ode-card">This link doesn’t work any more. Ask for a new one.</p>
      </main>
    );
  }

  const { friend, you } = load.view;
  // The friend's own money and the share button: under the cassette once there is one, so the song comes first.
  const money = (
    <>
      {you !== null && (
        <section aria-label="Your money" className="ode-card ode-money">
          <p className="ode-money-stats">
            <span className="ode-stat">Owed to you: <strong>{dollars(you.amountOwedCents)}</strong></span>
            <span className="ode-stat ode-stat--ok">Repaid so far: <strong>{dollars(you.amountRepaidCents)}</strong></span>
            {you.nextLineAtCents !== null && <span className="ode-stat">Next line unlocks at {dollars(you.nextLineAtCents)} repaid</span>}
          </p>
          <Meter repaidCents={you.amountRepaidCents} owedCents={you.amountOwedCents} />
        </section>
      )}
      {load.view.canShare && (
        <div className="ode-card">
          <ShareVerse token={token} />
        </div>
      )}
    </>
  );
  return (
    <main className="ode-page">
      <header>
        <Brand small />
        <h1 className="ode-title">An Ode for {friend}</h1>
      </header>
      {reconnecting && <p aria-live="polite" className="ode-notice">Reconnecting…</p>}
      {load.ode !== null ? (
        <Cassette ode={load.ode} title="The Ode">
          {money}
        </Cassette>
      ) : (
        <>
          <p className="ode-card">{load.view.ode.status === "making" ? "The Ode is being made…" : "The Ode isn’t ready yet."}</p>
          {money}
        </>
      )}
    </main>
  );
}
