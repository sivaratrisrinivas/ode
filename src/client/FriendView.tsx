import { useEffect, useState, type ReactElement } from "react";
import { Cassette, type ReadyOde, type Section, type VerseSection } from "./Cassette.tsx";

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
      {load.ode !== null ? (
        <Cassette ode={load.ode} title="The Ode" />
      ) : (
        <p>{load.view.ode.status === "making" ? "The Ode is being made…" : "The Ode isn’t ready yet."}</p>
      )}
    </main>
  );
}
