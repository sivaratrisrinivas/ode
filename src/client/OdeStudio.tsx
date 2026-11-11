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

const stepLabels: Record<string, string> = {
  writing: "Writing the lyrics",
  composing: "Composing the song",
  "finding-lines": "Finding every line",
};

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol aria-live="polite" style={{ paddingLeft: "1.25rem" }}>
      {steps.map((step) => (
        <li key={step.name} aria-current={step.state === "active" ? "step" : undefined} style={{ fontWeight: step.state === "active" ? 700 : 400 }}>
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
 * why the Ode was not made when the day's new Odes were used up: the visitor is back on the Seeded Ode.
 */
export function OdeStudio({ quiet = false, onFellBack }: { quiet?: boolean; onFellBack?: (message: string) => void }): ReactElement {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [startError, setStartError] = useState<string | null>(null);
  // Lines flagged in the lyrics preview; the Ode is not made while any is, or before the preview has said.
  const [flagged, setFlagged] = useState<number | null>(null);

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
      const res = await fetch("/api/ode", { method: "POST" });
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

  if (load.status === "loading") return <p>Loading…</p>;
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
      <section>
        <h2>Make the Ode</h2>
        {load.status === "making" ? (
          <Steps steps={load.steps} />
        ) : (
          <>
            {load.status === "failed" && <p role="alert" style={{ color: "#b00020" }}>{load.error}</p>}
            <button onClick={() => void make()} disabled={flagged === null || flagged > 0} aria-describedby={flagged !== null && flagged > 0 ? "flagged-why" : undefined}>
              {load.status === "failed" ? "Try again" : "Make the Ode"}
            </button>
            {flagged !== null && flagged > 0 && (
              <p id="flagged-why">
                {flagged === 1 ? "One lyric line is flagged" : `${flagged} lyric lines are flagged`}. Fix {flagged === 1 ? "it" : "them"} in the lyrics above to make the Ode.
              </p>
            )}
          </>
        )}
        {startError !== null && <p role="alert" style={{ color: "#b00020" }}>{startError}</p>}
      </section>
    </>
  );
}
