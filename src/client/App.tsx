import { useEffect, useState } from "react";
import { OdeStudio } from "./OdeStudio.tsx";
import { failureMessage, Warnings } from "./messages.tsx";

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
    <li style={{ marginBottom: "1.25rem" }}>
      <strong>{row.friend}</strong>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
        <label>
          Amount owed ($)
          <br />
          <input
            inputMode="decimal"
            value={amount}
            placeholder="0.00"
            onChange={(e) => setAmount(e.target.value)}
            onBlur={saveAmount}
            style={{ width: "7rem" }}
          />
        </label>
        <label style={{ flex: 1 }}>
          Inside joke
          <br />
          <input
            value={joke}
            onChange={(e) => setJoke(e.target.value)}
            onBlur={saveJoke}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
        </label>
      </div>
      <Warnings messages={row.warnings} />
      {problem !== null && <p role="alert" style={{ color: "#b00020", margin: "0.25rem 0 0" }}>{problem}</p>}
    </li>
  );
}

export function App() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [notes, setNotes] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  // Bumped whenever the whole ledger is replaced, so rows restart from the server's values.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/ledger")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((ledger: Ledger) => {
        setNotes(ledger.notes);
        setVersion((v) => v + 1);
        setLoad({ status: "ready", ledger });
      })
      .catch(() => setLoad({ status: "error" }));
  }, []);

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
      setBuildError("Couldn’t reach Ode. Check your connection and try again.");
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

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Ode</h1>
      {load.status === "loading" && <p>Loading…</p>}
      {load.status === "error" && <p>Couldn’t load your ledger. Try again in a moment.</p>}
      {load.status === "ready" && (
        <>
          <section>
            <label>
              <strong>Your trip notes</strong>
              <br />
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={10}
                placeholder="Paste your notes: who covered what, and the moments you remember."
                style={{ width: "100%", boxSizing: "border-box" }}
              />
            </label>
            <button onClick={() => void submitNotes()} disabled={building || notes.trim() === ""}>
              {building ? "Reading your notes…" : "Build the ledger"}
            </button>
            {buildError !== null && <p role="alert" style={{ color: "#b00020" }}>{buildError}</p>}
          </section>

          {(load.ledger.rows.length > 0 || load.ledger.warnings.length > 0) && (
            <section>
              <h2>Ledger</h2>
              <Warnings messages={load.ledger.warnings} />
              <ul style={{ padding: 0, listStyle: "none" }}>
                {load.ledger.rows.map((row) => (
                  <Row key={`${version}:${row.friend}`} row={row} onChange={replaceRow} />
                ))}
              </ul>
            </section>
          )}

          {load.ledger.rows.length > 0 && <OdeStudio key={version} />}
        </>
      )}
    </main>
  );
}
