import { useEffect, useRef, useState, type ReactElement } from "react";
import { UNREACHABLE } from "./messages.tsx";

/** One part of a verse share, as the API lists it: only what the friend may show. */
type ShareSection =
  | { kind: "intro" }
  | { kind: "verse"; friend: string; lines: string[] }
  | { kind: "hook"; text: string }
  | { kind: "chorus"; text: string };

/** What `GET /api/shares/:token` says. `stretches` are the pieces of `audioUrl`'s audio, in order, by their length in bytes and seconds. */
interface ShareView {
  friend: string;
  title: string;
  audioUrl: string;
  crossfadeMs: number;
  sections: ShareSection[];
  stretches: { durationMs: number; bytes: number }[];
}

type Load = { status: "loading" } | { status: "gone" } | { status: "error" } | { status: "ready"; view: ShareView };

/** Where the share is being played: nothing, the crossfaded pieces, or the plain audio element after the pieces could not be decoded. */
type Playing = "idle" | "crossfaded" | "plain";

/**
 * Play the stretches of a share one after another, each fading out under the next one fading in, so a jump from one part
 * of the song to another is not a click. Each stretch is decoded on its own, since each starts where the Ode's audio was cut.
 *
 * @returns Stops the playback. Rejects when the audio cannot be fetched or decoded.
 */
async function playCrossfaded(view: ShareView, context: AudioContext, onEnded: () => void): Promise<() => void> {
  const res = await fetch(view.audioUrl);
  if (!res.ok) throw new Error(`the share's audio answered ${res.status}`);
  const clip = await res.arrayBuffer();

  let offset = 0;
  const buffers = await Promise.all(
    view.stretches.map((stretch) => {
      const piece = clip.slice(offset, offset + stretch.bytes);
      offset += stretch.bytes;
      return context.decodeAudioData(piece);
    }),
  );

  const sources: AudioBufferSourceNode[] = [];
  let cursor = context.currentTime + 0.1;
  buffers.forEach((buffer, index) => {
    const fade = Math.min(view.crossfadeMs / 1000, buffer.duration / 2);
    const gain = context.createGain();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain).connect(context.destination);
    // Each stretch after the first starts while the one before is fading out.
    const start = index === 0 ? cursor : cursor - fade;
    const end = start + buffer.duration;
    gain.gain.setValueAtTime(index === 0 ? 1 : 0, start);
    if (index > 0) gain.gain.linearRampToValueAtTime(1, start + fade);
    if (index < buffers.length - 1) {
      gain.gain.setValueAtTime(1, end - fade);
      gain.gain.linearRampToValueAtTime(0, end);
    }
    source.start(start);
    sources.push(source);
    cursor = end;
  });
  sources.at(-1)?.addEventListener("ended", onEnded);
  return () => {
    for (const source of sources) {
      source.removeEventListener("ended", onEnded);
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    }
  };
}

/**
 * A verse share's page: what the friend chose to share and a button to play it. Anyone with the link sees this, and it shows
 * no amounts and no lines the friend has not unlocked, because the server sends none.
 *
 * @param props - The share's token, from the page's address.
 */
export function SharePage({ token }: { token: string }): ReactElement {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [playing, setPlaying] = useState<Playing>("idle");
  const stop = useRef<(() => void) | null>(null);
  const context = useRef<AudioContext | null>(null);
  const plain = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    fetch(`/api/shares/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 404) return setLoad({ status: "gone" });
        if (!res.ok) return setLoad({ status: "error" });
        setLoad({ status: "ready", view: await res.json() });
      })
      .catch(() => setLoad({ status: "error" }));
    return () => stop.current?.();
  }, [token]);

  // The plain audio element exists only after the fallback is chosen; it starts as soon as it does.
  useEffect(() => {
    if (playing === "plain") void plain.current?.play().catch(() => undefined);
  }, [playing]);

  const main = { fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "3rem auto", padding: "0 1rem" } as const;

  if (load.status === "loading") return <main style={main}><p>Loading…</p></main>;
  if (load.status === "gone") {
    return (
      <main style={main}>
        <h1>Ode</h1>
        <p>This link doesn’t work any more.</p>
      </main>
    );
  }
  if (load.status === "error") return <main style={main}><p>{UNREACHABLE}</p></main>;

  const { view } = load;

  async function play() {
    stop.current?.();
    try {
      context.current ??= new AudioContext();
      await context.current.resume();
      setPlaying("crossfaded");
      stop.current = await playCrossfaded(view, context.current, () => setPlaying("idle"));
    } catch {
      // The pieces could not be decoded or played apart; the whole clip plays as it is, cuts and all.
      setPlaying("plain");
    }
  }

  function pause() {
    stop.current?.();
    stop.current = null;
    plain.current?.pause();
    setPlaying("idle");
  }

  return (
    <main style={main}>
      <h1>{view.title}</h1>
      <div style={{ border: "2px solid #333", borderRadius: 12, padding: "1rem", background: "#faf7f0" }}>
        {playing === "idle" ? (
          <button onClick={() => void play()} style={{ font: "inherit", fontWeight: 700, padding: "0.5rem 1rem" }}>
            Play {view.friend}’s verse
          </button>
        ) : (
          <button onClick={pause} style={{ font: "inherit", fontWeight: 700, padding: "0.5rem 1rem" }}>
            Stop
          </button>
        )}
        {playing === "plain" && <audio ref={plain} controls src={view.audioUrl} onEnded={() => setPlaying("idle")} style={{ width: "100%", marginTop: "0.5rem" }} />}
        {view.sections.map((section, index) => {
          switch (section.kind) {
            case "intro":
              return <p key={index} style={{ color: "#555" }}>Intro</p>;
            case "verse":
              return (
                <div key={index}>
                  <strong>{section.friend}</strong>
                  {section.lines.map((line) => (
                    <p key={line} style={{ margin: "0.25rem 0" }}>{line}</p>
                  ))}
                </div>
              );
            case "hook":
              return <p key={index}><span style={{ color: "#555", marginRight: "0.5rem" }}>Hook</span>{section.text}</p>;
            case "chorus":
              return <p key={index}><span style={{ color: "#555", marginRight: "0.5rem" }}>Chorus</span>{section.text}</p>;
          }
        })}
      </div>
    </main>
  );
}
