import type { ReactElement } from "react";

/** The two reels of a cassette in a row: the mark in the brand and the window of the player. */
function Mark() {
  return (
    <svg viewBox="0 0 40 30" aria-hidden="true">
      <rect x="1.5" y="1.5" width="37" height="27" rx="5" fill="#ffcc2e" stroke="#1e1a15" strokeWidth="3" />
      <rect x="6" y="6" width="28" height="10" rx="5" fill="#1e1a15" />
      <circle cx="13" cy="11" r="3.2" fill="#fcf9f1" />
      <circle cx="27" cy="11" r="3.2" fill="#fcf9f1" />
      <path d="M11 24h18" stroke="#1e1a15" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The Ode wordmark with its cassette mark.
 *
 * @param props - `as` the element it is: the page's `h1` where it is the page's title, a plain paragraph elsewhere; `small`
 *   for the compact size; `href` makes it a link home.
 */
export function Brand({ as = "p", small = false, href }: { as?: "h1" | "p"; small?: boolean; href?: string }): ReactElement {
  const className = small ? "ode-brand ode-brand-small" : "ode-brand";
  const mark = (
    <>
      <Mark />
      Ode
    </>
  );
  if (href !== undefined) return <a className={className} href={href}>{mark}</a>;
  return as === "h1" ? <h1 className={className}>{mark}</h1> : <p className={className}>{mark}</p>;
}

/**
 * A bar of how much of what is owed has been repaid; empty when nothing is owed. It is a picture of the words beside it,
 * so a screen reader skips it.
 *
 * @param props - What has been repaid and what is owed, in cents.
 */
export function Meter({ repaidCents, owedCents }: { repaidCents: number; owedCents: number }): ReactElement {
  const percent = owedCents > 0 ? Math.min(100, Math.max(0, Math.round((repaidCents / owedCents) * 100))) : 0;
  return (
    <div className="ode-meter" aria-hidden="true">
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

/** The viewBox's width: the reels' centres and the room the tape has. */
const WIDTH = 560;
const HEIGHT = 80;
const LEFT = 195;
const RIGHT = 365;
/** The tape's pack is this wide on a full reel and on an empty one. */
const FULL = 36;
const EMPTY = 20;

/**
 * The window of a cassette: tape running between two reels. The pack on the left shrinks and the right one grows as the song
 * plays, and the reels turn while it does (the stylesheet turns them while the deck says it is playing).
 *
 * @param props - `progress` how much of the song has played, 0 to 1; values outside it are held to its ends.
 */
export function Reels({ progress }: { progress: number }): ReactElement {
  const played = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const left = FULL - (FULL - EMPTY) * played;
  const right = EMPTY + (FULL - EMPTY) * played;
  const hub = (cx: number) => (
    <g className="ode-reel-spin">
      <circle cx={cx} cy={HEIGHT / 2} r="15" fill="#fcf9f1" stroke="#1e1a15" strokeWidth="2" />
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <rect key={angle} x={cx - 1.6} y={HEIGHT / 2 - 14} width="3.2" height="7" rx="1" fill="#1e1a15" transform={`rotate(${angle} ${cx} ${HEIGHT / 2})`} />
      ))}
    </g>
  );
  return (
    <svg className="ode-reels" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <path d={`M${LEFT} ${HEIGHT / 2 + left} L${RIGHT} ${HEIGHT / 2 + right}`} stroke="#5a3d24" strokeWidth="3" />
      <circle cx={LEFT} cy={HEIGHT / 2} r={left} fill="#5a3d24" />
      <circle cx={RIGHT} cy={HEIGHT / 2} r={right} fill="#5a3d24" />
      {hub(LEFT)}
      {hub(RIGHT)}
    </svg>
  );
}
