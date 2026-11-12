import { useEffect, useRef, useState, type ReactElement } from "react";
import { Brand } from "./chrome.tsx";
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

/**
 * A page of the app shown inside this one, as tall as what it holds, so the browser window is the only thing that scrolls:
 * no page scrolling inside a page.
 *
 * @param props - `title` names the frame for a screen reader; `src` is the page it shows.
 */
function Pane({ title, src }: { title: string; src: string }): ReactElement {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    let watcher: ResizeObserver | null = null;
    // Follow the height of the page inside, from when it has loaded and as it changes (an Ode made, a banner shown).
    function follow(target: HTMLIFrameElement) {
      const body = target.contentDocument?.body;
      if (body == null) return;
      watcher?.disconnect();
      watcher = new ResizeObserver(() => void (target.style.height = `${body.offsetHeight}px`));
      watcher.observe(body);
    }
    const loaded = () => follow(element);
    element.addEventListener("load", loaded);
    loaded();
    return () => {
      element.removeEventListener("load", loaded);
      watcher?.disconnect();
    };
  }, [src]);
  return <iframe ref={frame} title={title} src={src} allow="autoplay" />;
}

/**
 * The landing page: the payer's page, alone at first, and on request ("Show a friend's view", or the address `/split`) a
 * friend's own view beside it with a picker for which friend. A payment made on the left unlocks the line on the right, because the right pane is that friend's live page.
 * The left pane is told to stay quiet, so the unlock is sung once, by the friend's pane. Every payment on the page counts
 * in this browser's own copy of the Seeded Ode, and "Reset demo" puts that copy back to unpaid for a retake. "Make my own
 * Ode" swaps the Seeded Ode for a new one built from the visitor's own notes, and "Back to the Seeded Ode" swaps it back.
 */
export function SplitScreen(): ReactElement {
  const [links, setLinks] = useState<FriendLink[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  // Whether the friend's side is shown. The landing page starts with the payer's side alone, one thing to look at; `/split` starts with both.
  const [both, setBoth] = useState(() => /^\/split\/?$/.test(location.pathname));
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
    <main className="ode-split" data-both={both ? "" : undefined}>
      <header className="ode-split-head">
        <div className="ode-split-brand">
          <Brand />
          <p className="ode-tagline">Pay your friends back in song.</p>
        </div>
        <div className="ode-split-tools">
          {mine && <span className="ode-split-tag">Your own Ode</span>}
          <button aria-pressed={both} onClick={() => setBoth((shown) => !shown)}>
            {both ? "Hide the friend’s view" : "Show a friend’s view"}
          </button>
          {/* What a visitor rarely needs is one step away, so the page keeps one thing in view. */}
          <details className="ode-menu" ref={menu}>
            <summary>More</summary>
            <div className="ode-menu-list" onClick={() => menu.current?.removeAttribute("open")}>
                  {mine ? (
                    <button onClick={() => void judgeOde("DELETE")} disabled={judgeBusy}>
                      Back to the Seeded Ode
                    </button>
                  ) : (
                    <button onClick={() => void judgeOde("POST")} disabled={judgeBusy}>
                      Make my own Ode
                    </button>
                  )}
                  <button onClick={() => void resetDemo()} disabled={resetting}>
                    Reset demo
                  </button>
            </div>
          </details>
          {resetError !== null && <span role="alert" className="ode-problem">{resetError}</span>}
          {judgeError !== null && <span role="alert" className="ode-problem">{judgeError}</span>}
        </div>
      </header>
      <section className="ode-split-pane" aria-label="You, the payer">
        <p className="ode-split-caption">You, the payer</p>
        {/* Beside the friend's pane the payer's stays quiet, so an unlock is sung once; alone, it sings the unlock itself. */}
        <Pane key={`${copy}:${both}`} title="Payer" src={both ? "/?quiet" : "/?pane"} />
      </section>
      {both && (
      <section className="ode-split-pane" aria-label="A friend's view">
        <div className="ode-split-caption">
          A friend’s view
          {shown !== undefined && (
            <div role="group" aria-label="Friend" className="ode-split-picker">
              {links.map((link) => (
                <button key={link.friend} aria-pressed={link.friend === shown.friend} onClick={() => setChosen(link.friend)}>
                  {link.friend}
                </button>
              ))}
            </div>
          )}
        </div>
        {shown === undefined ? (
          <p className="ode-split-empty">Make the Ode on the left, and a friend’s view appears here.</p>
        ) : (
          <Pane key={`${copy}:${shown.path}`} title="Friend view" src={shown.path} />
        )}
      </section>
      )}
    </main>
  );
}
