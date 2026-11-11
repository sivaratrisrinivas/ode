import { useEffect, useState, type ReactElement } from "react";
import { failureMessage, UNREACHABLE } from "./messages.tsx";

/** One friend the right pane can show, and the page their private link opens. */
interface FriendLink {
  friend: string;
  path: string;
}

/** What `GET /api/ode` answers, as far as the picker reads it. */
interface OdeAnswer {
  status: string;
  sections?: { kind: string; friend?: string; friendViewPath?: string | null }[];
}

const POLL_MS = 1000;

/**
 * The friends who have a private link, in song order. Empty until the Ode is made, since the links are shown with its verses.
 *
 * @param ode - The payer's `GET /api/ode` answer.
 */
function friendLinks(ode: OdeAnswer): FriendLink[] {
  if (ode.status !== "ready") return [];
  return (ode.sections ?? []).flatMap((section) =>
    section.kind === "verse" && section.friend !== undefined && typeof section.friendViewPath === "string" ? [{ friend: section.friend, path: section.friendViewPath }] : [],
  );
}

/** The bar above the panes: the visitor's own copy of the demo, with the way to start it again from unpaid or to make their own Ode. */
const BAR = { display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", gridColumn: "1 / -1" } as const;

/** Two panes side by side when there is room, stacked on a phone. */
const CSS = `
.ode-split { display: grid; grid-template-columns: 1fr; gap: 0.5rem; font-family: system-ui, sans-serif; }
.ode-split iframe { width: 100%; height: 90vh; border: 1px solid #ccc; border-radius: 6px; background: #fff; }
.ode-split-friend { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
.ode-split-pane { min-width: 0; }
@media (min-width: 800px) { .ode-split { grid-template-columns: 1fr 1fr; } .ode-split iframe { height: calc(100vh - 3rem); } }
`;

/**
 * The whole arc on one page: the payer's page on the left, and on the right a friend's own view with a picker for which
 * friend. A payment made on the left unlocks the line on the right, because the right pane is that friend's live page.
 * The left pane is told to stay quiet, so the unlock is sung once, by the friend's pane. Every payment on the page counts
 * in this browser's own copy of the Seeded Ode, and "Reset demo" puts that copy back to unpaid for a retake. "Make my own
 * Ode" swaps the Seeded Ode for a new one built from the visitor's own notes, and "Back to the Seeded Ode" swaps it back.
 */
export function SplitScreen(): ReactElement {
  const [links, setLinks] = useState<FriendLink[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  // Bumped by "Reset demo": both panes load again, so neither shows what was paid before the reset.
  const [copy, setCopy] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  // Whether the visitor is on their own Ode, and why they could not start one (the day's new Odes are used up).
  const [mine, setMine] = useState(false);
  const [judgeBusy, setJudgeBusy] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);

  /** Start (`POST`) or leave (`DELETE`) the visitor's own Ode, then load both panes again. */
  async function judgeOde(method: "POST" | "DELETE") {
    setJudgeBusy(true);
    setJudgeError(null);
    try {
      const res = await fetch("/api/judge-ode", { method });
      if (!res.ok) return setJudgeError(await failureMessage(res));
      setMine(method === "POST");
      setCopy((n) => n + 1);
    } catch {
      setJudgeError(UNREACHABLE);
    } finally {
      setJudgeBusy(false);
    }
  }

  async function resetDemo() {
    setResetting(true);
    setResetError(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      if (!res.ok) return setResetError(await failureMessage(res));
      setCopy((n) => n + 1);
    } catch {
      setResetError(UNREACHABLE);
    } finally {
      setResetting(false);
    }
  }

  // The links change when the Ode is made and when the ledger is built again, so keep asking.
  useEffect(() => {
    let live = true;
    async function look() {
      try {
        const [res, judge] = await Promise.all([fetch("/api/ode"), fetch("/api/judge-ode")]);
        if (!res.ok || !live) return;
        const found = friendLinks(await res.json());
        if (live) setLinks(found);
        // The panes can end the visitor's own Ode too: the day's new Odes run out while they are making theirs.
        if (judge.ok && live) setMine((await judge.json()).mine === true);
      } catch {
        // Keep what the picker showed; the next look may reach the server.
      }
    }
    void look();
    const timer = setInterval(() => void look(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const shown = links.find((link) => link.friend === chosen) ?? links[0];

  return (
    <main className="ode-split" style={{ padding: "0.5rem" }}>
      <style>{CSS}</style>
      <div style={BAR}>
        <button onClick={() => void resetDemo()} disabled={resetting}>
          Reset demo
        </button>
        {resetError !== null && <span role="alert" style={{ color: "#b00020" }}>{resetError}</span>}
        {mine ? (
          <>
            <span>Your own Ode</span>
            <button onClick={() => void judgeOde("DELETE")} disabled={judgeBusy}>
              Back to the Seeded Ode
            </button>
          </>
        ) : (
          <button onClick={() => void judgeOde("POST")} disabled={judgeBusy}>
            Make my own Ode
          </button>
        )}
        {judgeError !== null && <span role="alert" style={{ color: "#b00020" }}>{judgeError}</span>}
      </div>
      <section className="ode-split-pane" aria-label="You, the payer">
        <iframe key={copy} title="Payer" src="/?quiet" allow="autoplay" />
      </section>
      <section className="ode-split-friend" aria-label="A friend's view">
        {shown === undefined ? (
          <p>Make the Ode on the left, and a friend’s view appears here.</p>
        ) : (
          <>
            <div role="group" aria-label="Friend" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {links.map((link) => (
                <button key={link.friend} aria-pressed={link.friend === shown.friend} onClick={() => setChosen(link.friend)} style={{ fontWeight: link.friend === shown.friend ? 700 : 400 }}>
                  {link.friend}
                </button>
              ))}
            </div>
            <iframe key={`${copy}:${shown.path}`} title="Friend view" src={shown.path} allow="autoplay" />
          </>
        )}
      </section>
    </main>
  );
}
