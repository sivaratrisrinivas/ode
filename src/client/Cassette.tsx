import { useEffect, useRef, useState, type ReactElement } from "react";
import { PayFriend, type ClientId, type Payment } from "./PayFriend.tsx";

/** One lyric line and the stretch of the song it is sung in; `locked` until the friend's repayments reach its 25% step. */
interface TimedLine {
  text: string;
  startMs: number;
  endMs: number;
  locked: boolean;
}

/** A part of the Ode as the API lists it, in song order. */
type Section =
  | { kind: "intro"; startMs: number; endMs: number }
  | { kind: "verse"; friend: string; startMs: number; endMs: number; lines: TimedLine[]; payment: Payment | null }
  | { kind: "hook" | "chorus"; text: string; startMs: number; endMs: number };

/** A made Ode, ready to play. */
export interface ReadyOde {
  durationMs: number;
  audioUrl: string;
  sections: Section[];
}

/** A locked line's audio is cut to what a lowpass at this frequency lets through: words stay hidden, the beat doesn't. */
const MUFFLED_HZ = 300;
const CLEAR_HZ = 20_000;

function Row({
  label,
  text,
  span,
  locked = false,
  now,
  onPlay,
}: {
  label?: string;
  text: string;
  span: { startMs: number; endMs: number };
  locked?: boolean;
  now: number;
  onPlay: (ms: number) => void;
}) {
  const current = now >= span.startMs && now < span.endMs;
  return (
    <button
      onClick={() => onPlay(span.startMs)}
      aria-current={current}
      aria-label={locked ? "Locked line" : undefined}
      title={locked ? "Locked until this friend is paid back far enough" : undefined}
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
      <span style={locked ? { filter: "blur(5px)", userSelect: "none" } : undefined}>{text}</span>
    </button>
  );
}

/**
 * The cassette page: play the made Ode and follow the line being sung. A locked line is blurred and its audio is
 * muffled; hooks always play clear. A line is a button that jumps to where it is sung, and each verse has the
 * controls to pay its friend.
 *
 * @param props - The Ode with each line's lock, and what to do after a payment so the page shows the new locks.
 */
export function Cassette({ ode, onPaid }: { ode: ReadyOde; onPaid: () => void }): ReactElement {
  const audio = useRef<HTMLAudioElement>(null);
  const filter = useRef<{ context: AudioContext; lowpass: BiquadFilterNode } | null>(null);
  const frame = useRef(0);
  const [now, setNow] = useState(0);
  const [clientId, setClientId] = useState<ClientId>(undefined);

  // The locked stretches of the song, read by the muffling loop on every frame.
  const lockedWindows = useRef<{ startMs: number; endMs: number }[]>([]);
  lockedWindows.current = ode.sections.flatMap((section) => (section.kind === "verse" ? section.lines.filter((line) => line.locked) : []));

  useEffect(() => {
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((config: { paypalClientId: string | null }) => setClientId(config.paypalClientId))
      // Without the config the page cannot tell which way to pay; the keyless button is the safe offer, since the server decides what is paid.
      .catch(() => setClientId(null));
  }, []);

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
    element.currentTime = ms / 1000;
    void element.play();
  }

  return (
    <section>
      <h2>Your Ode</h2>
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
          onTimeUpdate={(event) => setNow(event.currentTarget.currentTime * 1000)}
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
                  {section.payment !== null && <PayFriend friend={section.friend} payment={section.payment} clientId={clientId} onPaid={onPaid} />}
                  {section.lines.map((line, lineIndex) => (
                    <Row key={lineIndex} text={line.text} span={line} locked={line.locked} now={now} onPlay={play} />
                  ))}
                </div>
              );
            case "hook":
              return <Row key={key} label="Hook" text={section.text} span={section} now={now} onPlay={play} />;
            case "chorus":
              return <Row key={key} label="Chorus" text={section.text} span={section} now={now} onPlay={play} />;
          }
        })}
      </div>
    </section>
  );
}
