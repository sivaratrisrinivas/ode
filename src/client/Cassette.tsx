import { useEffect, useRef, useState, type ReactElement } from "react";
import { PayFriend, type ClientId, type Payment } from "./PayFriend.tsx";

/** One lyric line and the stretch of the song it is sung in; `locked` until the friend's repayments reach its 25% step. */
interface TimedLine {
  text: string;
  startMs: number;
  endMs: number;
  locked: boolean;
}

/** A friend's verse as the payer's API lists it; `friendViewPath` is the friend's private page. */
export interface VerseSection {
  kind: "verse";
  friend: string;
  startMs: number;
  endMs: number;
  lines: TimedLine[];
  payment: Payment | null;
  friendViewPath?: string;
}

/** A part of the Ode as the API lists it, in song order. */
export type Section =
  | { kind: "intro"; startMs: number; endMs: number }
  | VerseSection
  | { kind: "hook"; text: string; startMs: number; endMs: number }
  | { kind: "chorus"; text: string; startMs: number; endMs: number; locked: boolean };

/** A made Ode, ready to play. `dropped` is the server's word that every friend is repaid; `trip` is what to call the trip once it is. */
export interface ReadyOde {
  durationMs: number;
  audioUrl: string;
  trip: string;
  dropped: boolean;
  sections: Section[];
}

/** A locked line's audio is cut to what a lowpass at this frequency lets through: words stay hidden, the beat doesn't. */
const MUFFLED_HZ = 300;
const CLEAR_HZ = 20_000;

/** How long the unlock banner and the line's glow stay up. */
const UNLOCK_MS = 4000;

/**
 * The unlock moment, drawn loud enough to survive video compression: a full-width banner and a line that flares
 * from blurred to clear in saturated colour. Under reduced motion the banner and glow stay, without the movement.
 */
const UNLOCK_CSS = `
@keyframes ode-unlock-line { 0% { background: #00c853; transform: scale(1.06); box-shadow: 0 0 0 0 #00c853; } 35% { background: #00e676; transform: scale(1.06); box-shadow: 0 0 28px 10px #00e676; } 100% { background: #fff3c4; transform: scale(1); box-shadow: 0 0 0 0 #00e67600; } }
@keyframes ode-unlock-unblur { from { filter: blur(5px); } to { filter: blur(0); } }
@keyframes ode-unlock-banner { 0% { transform: translateY(-12px) scale(0.9); opacity: 0; } 15% { transform: translateY(0) scale(1.04); opacity: 1; } 100% { transform: translateY(0) scale(1); opacity: 1; } }
.ode-unlock-line { animation: ode-unlock-line 2.4s ease-out both; }
.ode-unlock-text { animation: ode-unlock-unblur 0.6s ease-out both; }
.ode-unlock-banner { animation: ode-unlock-banner 0.5s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .ode-unlock-line { animation: none; background: #00e676; }
  .ode-unlock-text, .ode-unlock-banner { animation: none; }
}`;

/** A line that has just become clear, and where it is sung. */
interface UnlockedLine {
  friend: string;
  line: number;
  startMs: number;
  endMs: number;
}

/** Lines that were locked in `before` and are clear in `after`, first in song order; empty when nothing was unlocked. */
function newlyUnlocked(before: readonly Section[], after: readonly Section[]): UnlockedLine[] {
  return after.flatMap((section, index) => {
    const was = before[index];
    if (section.kind !== "verse" || was?.kind !== "verse") return [];
    return section.lines.flatMap((line, lineIndex) =>
      !line.locked && was.lines[lineIndex]?.locked === true ? [{ friend: section.friend, line: lineIndex, startMs: line.startMs, endMs: line.endMs }] : [],
    );
  });
}

function Row({
  label,
  text,
  span,
  locked = false,
  lockedLabel = "Locked line",
  fresh = false,
  now,
  onPlay,
}: {
  label?: string;
  text: string;
  span: { startMs: number; endMs: number };
  locked?: boolean;
  /** What a screen reader calls this row while it is locked. */
  lockedLabel?: string;
  /** Just unlocked: the line flares. */
  fresh?: boolean;
  now: number;
  onPlay: (ms: number) => void;
}) {
  const current = now >= span.startMs && now < span.endMs;
  return (
    <button
      onClick={() => onPlay(span.startMs)}
      className={fresh ? "ode-unlock-line" : undefined}
      aria-current={current}
      aria-label={locked ? lockedLabel : undefined}
      title={locked ? "Locked until the friends are paid back far enough" : undefined}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        font: "inherit",
        fontWeight: current ? 700 : 400,
        padding: "0.25rem 0.5rem",
        border: "none",
        borderRadius: 4,
        background: current ? "#fff3c4" : "transparent",
        cursor: "pointer",
      }}
    >
      {label !== undefined && <span style={{ color: "#555", marginRight: "0.5rem" }}>{label}</span>}
      <span className={fresh ? "ode-unlock-text" : undefined} style={locked ? { filter: "blur(5px)", userSelect: "none" } : undefined}>
        {text}
      </span>
    </button>
  );
}

/**
 * The cassette page: play the made Ode and follow the line being sung. A locked line is blurred and its audio is
 * muffled; hooks always play clear. A line is a button that jumps to where it is sung, and each verse has the
 * controls to pay its friend. When a new Ode arrives with lines that were locked now clear, the page announces
 * the unlock, flares those lines and plays the first of them.
 *
 * @param props - The Ode with each line's lock, and what to do after a payment so the page shows the new locks; without
 *   `onPaid` (a friend's page) there are no controls to pay, and no verse shows a friend's link. With `quiet` an unlock is
 *   still announced and flared but not played, for a page shown beside the friend's, whose pane plays it.
 */
export function Cassette({ ode, onPaid, title = "Your Ode", quiet = false }: { ode: ReadyOde; onPaid?: () => void; title?: string; quiet?: boolean }): ReactElement {
  const audio = useRef<HTMLAudioElement>(null);
  const filter = useRef<{ context: AudioContext; lowpass: BiquadFilterNode } | null>(null);
  const frame = useRef(0);
  const [now, setNow] = useState(0);
  const [clientId, setClientId] = useState<ClientId>(undefined);
  const [unlocked, setUnlocked] = useState<UnlockedLine[]>([]);
  // Where the unlock's playback ends: the end of the last line that unlocked. Null when nothing is being previewed.
  const stopAtMs = useRef<number | null>(null);
  const shown = useRef(ode.sections);

  // The locked stretches of the song, read by the muffling loop on every frame.
  const lockedWindows = useRef<{ startMs: number; endMs: number }[]>([]);
  lockedWindows.current = ode.sections.flatMap((section) => {
    if (section.kind === "verse") return section.lines.filter((line) => line.locked);
    return section.kind === "chorus" && section.locked ? [section] : [];
  });

  useEffect(() => {
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((config: { paypalClientId: string | null }) => setClientId(config.paypalClientId))
      // Without the config the page cannot tell which way to pay; the keyless button is the safe offer, since the server decides what is paid.
      .catch(() => setClientId(null));
  }, []);

  // A payment (by the capture response or the webhook, whichever came first) shows up as lines that were locked in
  // what the page showed before. They are announced, flared and played from the first of them.
  useEffect(() => {
    const fresh = newlyUnlocked(shown.current, ode.sections);
    shown.current = ode.sections;
    const first = fresh[0];
    const last = fresh[fresh.length - 1];
    if (first === undefined || last === undefined) return;
    setUnlocked(fresh);
    const element = audio.current;
    if (element !== null && !quiet) {
      element.currentTime = first.startMs / 1000;
      stopAtMs.current = last.endMs;
      void lowpass()?.context.resume();
      // Autoplay may be refused until the payer has touched the page; the banner and the flare still show.
      element.play().catch(() => undefined);
    }
    const timer = setTimeout(() => setUnlocked([]), UNLOCK_MS);
    return () => clearTimeout(timer);
  }, [ode.sections]);

  /** Route the audio through a lowpass, created on first play because browsers only start audio on a gesture. */
  function lowpass(): { context: AudioContext; lowpass: BiquadFilterNode } | null {
    const element = audio.current;
    if (element === null) return null;
    if (filter.current === null) {
      const context = new AudioContext();
      const node = context.createBiquadFilter();
      node.type = "lowpass";
      node.frequency.value = CLEAR_HZ;
      context.createMediaElementSource(element).connect(node).connect(context.destination);
      filter.current = { context, lowpass: node };
    }
    return filter.current;
  }

  function muffle() {
    const element = audio.current;
    const chain = filter.current;
    if (element === null || chain === null) return;
    const ms = element.currentTime * 1000;
    const locked = lockedWindows.current.some((line) => ms >= line.startMs && ms < line.endMs);
    chain.lowpass.frequency.setTargetAtTime(locked ? MUFFLED_HZ : CLEAR_HZ, chain.context.currentTime, 0.02);
  }

  function follow() {
    muffle();
    frame.current = requestAnimationFrame(follow);
  }

  function stopFollowing() {
    cancelAnimationFrame(frame.current);
    muffle();
  }

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function play(ms: number) {
    const element = audio.current;
    if (element === null) return;
    stopAtMs.current = null;
    element.currentTime = ms / 1000;
    void element.play();
  }

  return (
    <section>
      <style>{UNLOCK_CSS}</style>
      <h2>{title}</h2>
      {ode.dropped && (
        <p
          className="ode-unlock-banner"
          style={{ background: "#ffd600", color: "#000", border: "4px solid #000", borderRadius: 12, padding: "0.75rem 1rem", margin: "0 0 0.75rem", fontSize: "1.5rem", fontWeight: 800, textAlign: "center" }}
        >
          Full Ode dropped · {ode.trip}
        </p>
      )}
      {unlocked.length > 0 && (
        <div
          role="status"
          className="ode-unlock-banner"
          style={{ background: "#00c853", color: "#000", border: "4px solid #000", borderRadius: 12, padding: "0.75rem 1rem", margin: "0 0 0.75rem", fontSize: "1.5rem", fontWeight: 800, textAlign: "center" }}
        >
          🔓 {unlocked[0]?.friend}: {unlocked.length === 1 ? `line ${(unlocked[0]?.line ?? 0) + 1}` : `lines ${unlocked.map((u) => u.line + 1).join(", ")}`} unlocked!
        </div>
      )}
      <div style={{ border: "2px solid #333", borderRadius: 12, padding: "1rem", background: "#faf7f0" }}>
        <audio
          ref={audio}
          controls
          preload="metadata"
          src={ode.audioUrl}
          onPlay={() => {
            void lowpass()?.context.resume();
            cancelAnimationFrame(frame.current);
            follow();
          }}
          onPause={stopFollowing}
          onEnded={stopFollowing}
          onSeeked={muffle}
          onTimeUpdate={(event) => {
            const ms = event.currentTarget.currentTime * 1000;
            setNow(ms);
            // The unlock plays the lines it unlocked and stops, instead of running on into locked ones.
            if (stopAtMs.current !== null && ms >= stopAtMs.current) {
              stopAtMs.current = null;
              event.currentTarget.pause();
            }
          }}
          style={{ width: "100%" }}
        />
        {ode.sections.map((section, index) => {
          const key = `${index}:${section.kind}`;
          switch (section.kind) {
            case "intro":
              return <Row key={key} text="Intro" span={section} now={now} onPlay={play} />;
            case "verse":
              return (
                <div key={key} style={{ marginTop: "0.75rem" }}>
                  <strong>{section.friend}</strong>
                  {onPaid !== undefined && section.friendViewPath !== undefined && (
                    <p style={{ margin: "0.25rem 0" }}>
                      <a href={section.friendViewPath}>{section.friend}’s private link</a>
                    </p>
                  )}
                  {onPaid !== undefined && section.payment !== null && <PayFriend friend={section.friend} payment={section.payment} clientId={clientId} onPaid={onPaid} />}
                  {section.lines.map((line, lineIndex) => (
                    <Row
                      key={lineIndex}
                      text={line.text}
                      span={line}
                      locked={line.locked}
                      fresh={unlocked.some((u) => u.friend === section.friend && u.line === lineIndex)}
                      now={now}
                      onPlay={play}
                    />
                  ))}
                </div>
              );
            case "hook":
              return <Row key={key} label="Hook" text={section.text} span={section} now={now} onPlay={play} />;
            case "chorus":
              return <Row key={key} label="Chorus" text={section.text} span={section} locked={section.locked} lockedLabel="Locked chorus" now={now} onPlay={play} />;
          }
        })}
      </div>
    </section>
  );
}
