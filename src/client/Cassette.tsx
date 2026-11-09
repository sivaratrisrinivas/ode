import { useRef, useState, type ReactElement } from "react";

/** One lyric line and the stretch of the song it is sung in. */
interface TimedLine {
  text: string;
  startMs: number;
  endMs: number;
}

/** A part of the Ode as the API lists it, in song order. */
type Section =
  | { kind: "intro"; startMs: number; endMs: number }
  | { kind: "verse"; friend: string; startMs: number; endMs: number; lines: TimedLine[] }
  | { kind: "hook" | "chorus"; text: string; startMs: number; endMs: number };

/** A made Ode, ready to play. */
export interface ReadyOde {
  durationMs: number;
  audioUrl: string;
  sections: Section[];
}

function Row({ label, text, span, now, onPlay }: { label?: string; text: string; span: { startMs: number; endMs: number }; now: number; onPlay: (ms: number) => void }) {
  const current = now >= span.startMs && now < span.endMs;
  return (
    <button
      onClick={() => onPlay(span.startMs)}
      aria-current={current}
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
      {text}
    </button>
  );
}

/**
 * The cassette page: play the made Ode and follow the line being sung. Every line is clear here;
 * locking lines comes with payments. A line is a button that jumps to where it is sung.
 */
export function Cassette({ ode }: { ode: ReadyOde }): ReactElement {
  const audio = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);

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
                  {section.lines.map((line, lineIndex) => (
                    <Row key={lineIndex} text={line.text} span={line} now={now} onPlay={play} />
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
