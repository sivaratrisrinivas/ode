import { useEffect, useState, type ReactElement } from "react";
import { Cassette, type ReadyOde } from "./Cassette.tsx";
import { LyricsPreview } from "./LyricsPreview.tsx";
import { failureMessage, UNREACHABLE } from "./messages.tsx";

interface Step {
  name: string;
  state: "done" | "active" | "waiting";
}

/** What `GET /api/ode` and `POST /api/ode` answer. */
type OdeResponse =
  | { status: "none" }
  | { status: "making"; steps: Step[] }
  | { status: "failed"; error: string }
  | ({ status: "ready" } & ReadyOde);

type Load = { status: "loading" } | { status: "unreachable" } | OdeResponse;

const POLL_MS = 1000;

/** `YYYY-MM-DD` for a day this many days from today in the browser's own calendar; the server decides what dates are allowed. */
function dateInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const stepLabels: Record<string, string> = {
  writing: "Writing the lyrics",
  composing: "Composing the song",
  "finding-lines": "Finding every line",
};

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol aria-live="polite" className="ode-steps">
      {steps.map((step) => (
        <li key={step.name} aria-current={step.state === "active" ? "step" : undefined} data-done={step.state === "done" ? "" : undefined}>
          {step.state === "done" ? "Done: " : ""}
          {stepLabels[step.name] ?? step.name}
          {step.state === "active" ? "…" : ""}
        </li>
      ))}
    </ol>
  );
}

/**
 * The lyrics to review and the one "Make the Ode" action; then the status steps while it is made,
 * a retry if it fails, and the cassette to play once it is ready. `quiet` is passed on to the cassette. `onFellBack` hears
 * why the Ode was not made when the day's new Odes were used up: the visitor is back on the Seeded Ode. `onReady` hears
 * whether the Ode is made and showing, so the page can put it first; false again once this goes away.
 */
export function OdeStudio({ quiet = false, onFellBack, onReady }: { quiet?: boolean; onFellBack?: (message: string) => void; onReady?: (ready: boolean) => void }): ReactElement {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [startError, setStartError] = useState<string | null>(null);
  // Lines flagged in the lyrics preview; the Ode is not made while any is, or before the preview has said.
  const [flagged, setFlagged] = useState<number | null>(null);
  // The promise to the friends, a month out unless the payer picks another day; it is required, and cannot be changed once the Ode is made.
  const [releaseDate, setReleaseDate] = useState(() => dateInDays(30));

  async function refresh() {
    // A failed poll mid-run is not the end of the run: keep the steps on screen and ask again.
    const unreachable = (current: Load): Load => (current.status === "making" ? current : { status: "unreachable" });
    try {
      const res = await fetch("/api/ode");
      if (!res.ok) return setLoad(unreachable);
      const ode: OdeResponse = await res.json();
      setLoad(ode);
    } catch {
      setLoad(unreachable);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const isReady = load.status === "ready";
  useEffect(() => {
    onReady?.(isReady);
  }, [isReady]);
  useEffect(() => () => onReady?.(false), []);

  // While the Ode is being made, ask again every second until the run settles.
  const making = load.status === "making";
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [making]);

  async function make() {
    setStartError(null);
    try {
      const res = await fetch("/api/ode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ releaseDate }),
      });
      if (res.status === 409) {
        // Already made (in another tab): show it.
        await refresh();
        return;
      }
      if (res.status === 429) {
        // The day's new Odes are used up: the server has put this visitor back on the Seeded Ode.
        const message = await failureMessage(res);
        if (onFellBack !== undefined) return onFellBack(message);
        return setStartError(message);
      }
      if (!res.ok) return setStartError(await failureMessage(res));
      const started: OdeResponse = await res.json();
      setLoad(started);
    } catch {
      setStartError(UNREACHABLE);
    }
  }

  if (load.status === "loading") return <p className="ode-loading">Loading…</p>;
  if (load.status === "unreachable") {
    return (
      <>
        <p>Couldn’t load your Ode. Try again in a moment.</p>
        <button onClick={() => void refresh()}>Try again</button>
      </>
    );
  }
  if (load.status === "ready") return <Cassette ode={load} onPaid={() => void refresh()} quiet={quiet} />;

  return (
    <>
      {/* The lyrics are read when the run starts, so they are not editable while it runs. */}
      {load.status !== "making" && <LyricsPreview onFlagged={setFlagged} />}
      <section className="ode-card ode-step">
        <h2>Make the Ode</h2>
        {load.status === "making" ? (
          <Steps steps={load.steps} />
        ) : (
          <>
            {load.status === "failed" && <p role="alert" className="ode-problem">{load.error}</p>}
            <div className="ode-release">
              <label>
                Release date <input type="date" required value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} />
              </label>
              <small>The day you promise the whole Ode drops. It can’t be changed after you make the Ode.</small>
            </div>
            <div className="ode-actions">
            <button className="primary" onClick={() => void make()} disabled={releaseDate === "" || flagged === null || flagged > 0} aria-describedby={flagged !== null && flagged > 0 ? "flagged-why" : undefined}>
              {load.status === "failed" ? "Try again" : "Make the Ode"}
            </button>
            </div>
            {flagged !== null && flagged > 0 && (
              <p id="flagged-why" className="ode-problem">
                {flagged === 1 ? "One lyric line is flagged" : `${flagged} lyric lines are flagged`}. Fix {flagged === 1 ? "it" : "them"} in the lyrics above to make the Ode.
              </p>
            )}
          </>
        )}
        {startError !== null && <p role="alert" className="ode-problem">{startError}</p>}
      </section>
    </>
  );
}
