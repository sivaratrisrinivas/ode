import { useEffect, useRef, useState, type ReactElement } from "react";
import { Brand, Reels } from "./chrome.tsx";
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

  if (load.status === "loading") return <main className="ode-page"><p className="ode-loading">Loading…</p></main>;
  if (load.status === "gone") {
    return (
      <main className="ode-page">
        <Brand as="h1" />
        <p className="ode-card">This link doesn’t work any more.</p>
      </main>
    );
  }
  if (load.status === "error") return <main className="ode-page"><p className="ode-card">{UNREACHABLE}</p></main>;

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

  const PlayIcon = (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 3.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
  const StopIcon = (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4.5" y="4.5" width="11" height="11" rx="1.5" fill="currentColor" />
    </svg>
  );

  return (
    <main className="ode-page">
      <header>
        <Brand small href="/" />
        <h1 className="ode-title">{view.title}</h1>
      </header>
      <div className="ode-share-card">
        <div className="ode-deck" data-playing={playing === "idle" ? undefined : ""}>
          <div className="ode-deck-label">
            <p className="ode-deck-trip">{view.friend}’s verse</p>
            <p className="ode-deck-side">A</p>
          </div>
          <div className="ode-deck-window">
            <Reels progress={0.35} />
          </div>
          <div className="ode-deck-tray">
            {playing === "idle" ? (
              <button className="primary ode-play" onClick={() => void play()}>
                {PlayIcon}
                Play {view.friend}’s verse
              </button>
            ) : (
              <button className="primary ode-play" onClick={pause}>
                {StopIcon}
                Stop
              </button>
            )}
            {playing === "plain" && <audio ref={plain} controls src={view.audioUrl} onEnded={() => setPlaying("idle")} />}
          </div>
        </div>
        <div className="ode-card ode-jcard">
          {view.sections.map((section, index) => {
            switch (section.kind) {
              case "intro":
                return <p key={index} className="ode-jcard-part ode-hint">Intro</p>;
              case "verse":
                return (
                  <div key={index} className="ode-jcard-verse">
                    <strong>{section.friend}</strong>
                    {section.lines.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                );
              case "hook":
                return <p key={index} className="ode-jcard-part"><span className="ode-tag">Hook</span>{section.text}</p>;
              case "chorus":
                return <p key={index} className="ode-jcard-part"><span className="ode-tag">Chorus</span>{section.text}</p>;
            }
          })}
        </div>
      </div>
    </main>
  );
}
