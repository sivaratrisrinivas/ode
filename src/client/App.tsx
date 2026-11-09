import { useEffect, useState } from "react";

interface LedgerRow {
  friend: string;
  amountOwedCents: number;
  insideJoke: string;
}

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; rows: LedgerRow[] };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    fetch("/api/ledger")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { rows: LedgerRow[] }) => setState({ status: "ready", rows: body.rows }))
      .catch(() => setState({ status: "error" }));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Ode</h1>
      {state.status === "loading" && <p>Loading the ledger…</p>}
      {state.status === "error" && <p>Couldn’t load the ledger. Try again in a moment.</p>}
      {state.status === "ready" && (
        <ul style={{ padding: 0, listStyle: "none" }}>
          {state.rows.map((row) => (
            <li key={row.friend}>
              <strong>{row.friend}</strong> · {dollars(row.amountOwedCents)}
              <br />
              <em>{row.insideJoke}</em>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
