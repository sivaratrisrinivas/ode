import { useEffect, useState, type ReactElement } from "react";

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
 * The left pane is told to stay quiet, so the unlock is sung once, by the friend's pane.
 */
export function SplitScreen(): ReactElement {
  const [links, setLinks] = useState<FriendLink[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);

  // The links change when the Ode is made and when the ledger is built again, so keep asking.
  useEffect(() => {
    let live = true;
    async function look() {
      try {
        const res = await fetch("/api/ode");
        if (!res.ok || !live) return;
        const found = friendLinks(await res.json());
        if (live) setLinks(found);
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
      <section className="ode-split-pane" aria-label="You, the payer">
        <iframe title="Payer" src="/?quiet" allow="autoplay" />
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
            <iframe title="Friend view" src={shown.path} allow="autoplay" />
          </>
        )}
      </section>
    </main>
  );
}
