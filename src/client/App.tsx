import { useEffect, useState } from "react";
import { Brand, GrowingField } from "./chrome.tsx";
import { OdeStudio } from "./OdeStudio.tsx";
import { failureMessage, UNREACHABLE, Warnings } from "./messages.tsx";

interface LedgerRow {
  friend: string;
  amountOwedCents: number | null;
  insideJoke: string;
  warnings: string[];
}

interface Ledger {
  notes: string;
  rows: LedgerRow[];
  warnings: string[];
}

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; ledger: Ledger };

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

function Row({ row, onChange }: { row: LedgerRow; onChange: (row: LedgerRow) => void }) {
  const [amount, setAmount] = useState(dollars(row.amountOwedCents));
  const [joke, setJoke] = useState(row.insideJoke);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(edit: { amountOwedCents?: number; insideJoke?: string }) {
    const res = await fetch(`/api/ledger/${encodeURIComponent(row.friend)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(edit),
    });
    if (!res.ok) return setProblem(await failureMessage(res));
    setProblem(null);
    const updated: LedgerRow = await res.json();
    onChange(updated);
  }

  function saveAmount() {
    if (amount === dollars(row.amountOwedCents)) return;
    const cents = Math.round(Number(amount) * 100);
    if (amount.trim() === "" || !Number.isFinite(cents)) return setProblem("Enter an amount like 97.50.");
    void save({ amountOwedCents: cents });
  }

  function saveJoke() {
    if (joke.trim() !== row.insideJoke) void save({ insideJoke: joke });
  }

  return (
    <li className="ode-ledger-row">
      <span className="ode-avatar" aria-hidden="true">{[...row.friend][0]}</span>
      <div className="ode-ledger-body">
        <strong className="ode-ledger-name">{row.friend}</strong>
        <div className="ode-ledger-fields">
          <label>
            Amount owed ($)
            <input
              className="ode-money-input"
              inputMode="decimal"
              value={amount}
              placeholder="0.00"
              onChange={(e) => setAmount(e.target.value)}
              onBlur={saveAmount}
            />
          </label>
          <label>
            Inside joke
            <GrowingField value={joke} onChange={setJoke} onBlur={saveJoke} />
          </label>
        </div>
        <Warnings messages={row.warnings} />
        {problem !== null && <p role="alert" className="ode-problem">{problem}</p>}
      </div>
    </li>
  );
}

/**
 * The payer's page.
 *
 * @param props - `quiet`: do not play the audio of a line that has just unlocked (the split screen's friend pane does).
 */
export function App({ quiet = false }: { quiet?: boolean }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [notes, setNotes] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  // Bumped whenever the whole ledger is replaced, so rows restart from the server's values.
  const [version, setVersion] = useState(0);
  // Why the visitor is looking at the Seeded Ode instead of the Ode they were making.
  const [notice, setNotice] = useState<string | null>(null);
  // Whether the Ode is made and playing: then it comes first on the page, and the notes it was made from fold away under it.
  const [odeReady, setOdeReady] = useState(false);

  /** Load the ledger of the Ode the visitor is on, and show it from the server's values. */
  function loadLedger() {
    return fetch("/api/ledger")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((ledger: Ledger) => {
        setNotes(ledger.notes);
        setVersion((v) => v + 1);
        setLoad({ status: "ready", ledger });
      })
      .catch(() => setLoad({ status: "error" }));
  }

  useEffect(() => {
    void loadLedger();
  }, []);

  function fellBack(message: string) {
    setNotice(message);
    void loadLedger();
  }

  async function submitNotes() {
    if (load.status === "ready" && load.ledger.rows.length > 0 && !window.confirm("Building a new ledger replaces the current one, including your edits, the lyrics and the Ode. Continue?")) {
      return;
    }
    setBuilding(true);
    setBuildError(null);
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) return setBuildError(await failureMessage(res));
      const ledger: Ledger = await res.json();
      setVersion((v) => v + 1);
      setLoad({ status: "ready", ledger });
    } catch {
      setBuildError(UNREACHABLE);
    } finally {
      setBuilding(false);
    }
  }

  function replaceRow(updated: LedgerRow) {
    setLoad((current) =>
      current.status === "ready"
        ? {
            status: "ready",
            ledger: {
              ...current.ledger,
              rows: current.ledger.rows.map((row) => (row.friend === updated.friend ? updated : row)),
            },
          }
        : current,
    );
  }

  const setup = (
    <details key="setup" className="ode-setup" open={!odeReady} data-ready={odeReady ? "" : undefined}>
      <summary>Trip notes and ledger</summary>
      <section className="ode-card ode-step">
        <h2>Trip notes</h2>
        <label>
          <span className="ode-label">Your trip notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={8}
            placeholder="Paste your notes: who covered what, and the moments you remember."
          />
        </label>
        <div className="ode-actions">
          <button className="primary" onClick={() => void submitNotes()} disabled={building || notes.trim() === ""}>
            {building ? "Reading your notes…" : "Build the ledger"}
          </button>
        </div>
        {buildError !== null && <p role="alert" className="ode-problem">{buildError}</p>}
      </section>

      {load.status === "ready" && (load.ledger.rows.length > 0 || load.ledger.warnings.length > 0) && (
        <section className="ode-card ode-step">
          <h2>Ledger</h2>
          <Warnings messages={load.ledger.warnings} />
          <ul className="ode-ledger">
            {load.ledger.rows.map((row) => (
              <Row key={`${version}:${row.friend}`} row={row} onChange={replaceRow} />
            ))}
          </ul>
        </section>
      )}
    </details>
  );
  // Keyed, so the studio keeps its state when the made Ode moves above the notes it was made from.
  const studio = load.status === "ready" && load.ledger.rows.length > 0 && (
    <div key="studio" className="ode-studio">
      <OdeStudio key={version} quiet={quiet} onFellBack={fellBack} onReady={setOdeReady} />
    </div>
  );

  return (
    <main className="ode-page">
      <Brand as="h1" />
      {notice !== null && <p role="status" className="ode-notice">{notice}</p>}
      {load.status === "loading" && <p className="ode-loading">Loading…</p>}
      {load.status === "error" && <p>Couldn’t load your ledger. Try again in a moment.</p>}
      {load.status === "ready" && <div className="ode-flow">{odeReady ? [studio, setup] : [setup, studio]}</div>}
    </main>
  );
}
