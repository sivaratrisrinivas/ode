import { Component, lazy, Suspense, useLayoutEffect, useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { clamp01, classNames } from "./helpers.ts";
import { sceneTier, stepDown } from "./scene/quality.ts";

// three.js is most of the page's weight, so it is fetched only by a device that will draw the 3D cassette, after the page shows.
const CassetteScene = lazy(() => import("./scene/CassetteScene.tsx"));

/** Shows `fallback` in place of its children once one of them has thrown: a lost WebGL context must not take the player with it. */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The brand's mark: a small cassette, drawn in the stylesheet's colours. */
function Mark() {
  return (
    <svg viewBox="0 0 40 30" aria-hidden="true">
      <rect x="1.5" y="1.5" width="37" height="27" rx="5" fill="var(--tape)" stroke="var(--ink)" strokeWidth="3" />
      <rect x="6" y="6" width="28" height="10" rx="5" fill="var(--ink)" />
      <circle cx="13" cy="11" r="3.2" fill="var(--card)" />
      <circle cx="27" cy="11" r="3.2" fill="var(--card)" />
      <path d="M11 24h18" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
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
  const className = classNames("ode-brand", small && "ode-brand-small");
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
 * @param props - What has been repaid and what is owed, in cents; the bar is full once the repaid amount reaches what is owed, and never more.
 */
export function Meter({ repaidCents, owedCents }: { repaidCents: number; owedCents: number }): ReactElement {
  const percent = owedCents > 0 ? Math.round(clamp01(repaidCents / owedCents) * 100) : 0;
  return (
    <div className="ode-meter" aria-hidden="true">
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

/** The reels' window is this many units wide and high in its own coordinates. */
const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 80;
/** Where the two reels' centres sit across the window; their centres share the window's middle height. */
const LEFT_REEL_X = 75;
const RIGHT_REEL_X = 245;
/** The tape's pack is this wide (a radius) on a full reel and on an empty one. */
const FULL_PACK = 36;
const EMPTY_PACK = 20;
/** The radius of each reel's hub, which turns while the song plays. */
const HUB_RADIUS = 15;

/**
 * The window of a cassette: tape running between two reels. The pack on the left shrinks and the right one grows as the song
 * plays, and the reels turn while it does (the stylesheet turns them while the deck says it is playing).
 *
 * @param props - `progress` how much of the song has played, 0 to 1; values outside it are held to its ends.
 */
export function Reels({ progress }: { progress: number }): ReactElement {
  const played = clamp01(progress);
  const leftPack = FULL_PACK - (FULL_PACK - EMPTY_PACK) * played;
  const rightPack = EMPTY_PACK + (FULL_PACK - EMPTY_PACK) * played;
  const middle = VIEW_HEIGHT / 2;
  const hub = (cx: number) => (
    <g className="ode-reel-spin">
      <circle cx={cx} cy={middle} r={HUB_RADIUS} fill="var(--card)" stroke="var(--ink)" strokeWidth="2" />
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <rect key={angle} x={cx - 1.6} y={middle - HUB_RADIUS + 1} width="3.2" height="7" rx="1" fill="var(--ink)" transform={`rotate(${angle} ${cx} ${middle})`} />
      ))}
    </g>
  );
  return (
    <svg className="ode-reels" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} aria-hidden="true">
      <path d={`M${LEFT_REEL_X} ${middle + leftPack} L${RIGHT_REEL_X} ${middle + rightPack}`} stroke="var(--tape-brown)" strokeWidth="3" />
      <circle cx={LEFT_REEL_X} cy={middle} r={leftPack} fill="var(--tape-brown)" />
      <circle cx={RIGHT_REEL_X} cy={middle} r={rightPack} fill="var(--tape-brown)" />
      {hub(LEFT_REEL_X)}
      {hub(RIGHT_REEL_X)}
    </svg>
  );
}

/**
 * The cassette an Ode is heard on, with a tray under it for what plays or controls it. Where the device can draw it, the
 * cassette is the 3D one (see `CassetteScene`); until that has loaded, and wherever it cannot be drawn, it is the flat
 * drawing, in the same space, so the page does not jump.
 *
 * @param props - `label` what is written on the cassette; `progress` how far the song has played, 0 to 1 (see `Reels`);
 *   `playing` whether the reels turn; `clarity` how much of the Ode is unlocked, 0 to 1 (the 3D window is frosted by the
 *   rest); `flare` true while a line has just unlocked; `dropped` whether the chorus has dropped; `children` the tray's contents.
 */
export function Deck({
  label,
  progress,
  playing,
  clarity = 1,
  flare = false,
  dropped = false,
  children,
}: {
  label: string;
  progress: number;
  playing: boolean;
  clarity?: number;
  flare?: boolean;
  dropped?: boolean;
  children: ReactNode;
}): ReactElement {
  // The tier starts from what the device says about itself and steps down if the scene measures itself slow.
  const [tier, setTier] = useState(sceneTier);
  const flat = (
    <div className="ode-deck-shell">
      <div className="ode-deck-label">
        <p className="ode-deck-trip">{label}</p>
        <p className="ode-deck-side">A</p>
      </div>
      <div className="ode-deck-window">
        <Reels progress={progress} />
      </div>
    </div>
  );
  return (
    <div className="ode-deck" data-playing={playing ? "" : undefined}>
      <div className="ode-deck-stage">
        {tier === null ? (
          flat
        ) : (
          <SceneBoundary fallback={flat}>
            <Suspense fallback={flat}>
              <CassetteScene label={label} progress={progress} playing={playing} clarity={clarity} flare={flare} dropped={dropped} tier={tier} onSlow={(hopeless) => setTier(stepDown(tier, hopeless))} />
            </Suspense>
          </SceneBoundary>
        )}
      </div>
      <div className="ode-deck-tray">{children}</div>
    </div>
  );
}

/** Whether the browser sizes a textarea to its text by itself (`field-sizing: content`). */
const SIZES_ITSELF = typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");

/**
 * A text field of one line that wraps and grows to show everything typed, instead of cutting a long line off at its edge. A
 * line break (Enter, or one in pasted text) becomes a space, so the value stays one line of text.
 *
 * @param props - The textarea's own props, without `rows` and `onChange`; `onChange` gets the new text.
 */
export function GrowingField({ onChange, ...props }: Omit<ComponentProps<"textarea">, "rows" | "onChange"> & { onChange: (text: string) => void }): ReactElement {
  const field = useRef<HTMLTextAreaElement>(null);
  // Where the browser cannot size the field itself, fit it to its text after each change.
  useLayoutEffect(() => {
    const element = field.current;
    if (SIZES_ITSELF || element === null) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, [props.value]);
  return (
    <textarea
      {...props}
      ref={field}
      rows={1}
      className={classNames("ode-growing", props.className)}
      onChange={(event) => onChange(event.target.value.replace(/\s*\n\s*/g, " "))}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
        props.onKeyDown?.(event);
      }}
    />
  );
}
