import { useEffect, useState } from "react";
import { failureMessage, Warnings } from "./messages.tsx";

const MAX_LINE_LENGTH = 200;

interface Line {
  text: string;
  problems: string[];
}

interface Lyrics {
  verses: { friend: string; lines: Line[] }[];
  hook: Line | null;
  chorus: Line | null;
}

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; lyrics: Lyrics };

/** Where a line lives, as the API addresses it. */
type Target = { kind: "verse"; friend: string; index: number } | { kind: "hook" } | { kind: "chorus" };

function endpoint(target: Target): string {
  return target.kind === "verse"
    ? `/api/lyrics/verses/${encodeURIComponent(target.friend)}/lines/${target.index + 1}`
    : `/api/lyrics/${target.kind}`;
}

function withLine(lyrics: Lyrics, target: Target, line: Line): Lyrics {
  if (target.kind === "hook") return { ...lyrics, hook: line };
  if (target.kind === "chorus") return { ...lyrics, chorus: line };
  return {
    ...lyrics,
    verses: lyrics.verses.map((verse) =>
      verse.friend === target.friend
        ? { ...verse, lines: verse.lines.map((existing, index) => (index === target.index ? line : existing)) }
        : verse,
    ),
  };
}

function LineField({ label, line, target, onSaved }: { label: string; line: Line; target: Target; onSaved: (line: Line) => void }) {
  const [text, setText] = useState(line.text);
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    // A flagged line saves even when unchanged: saving re-checks it, which clears a flag about a cut.
    if (text.trim() === line.text && line.problems.length === 0) return;
    try {
      const res = await fetch(endpoint(target), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return setProblem(await failureMessage(res));
      setProblem(null);
      const saved: Line = await res.json();
      setText(saved.text);
      onSaved(saved);
    } catch {
      setProblem("Couldn’t reach Ode. Check your connection and try again.");
    }
  }

  const flagged = line.problems.length > 0;
  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <label>
        <span style={{ fontSize: "0.85rem", color: "#555" }}>{label}</span>
        <input
          value={text}
          maxLength={MAX_LINE_LENGTH}
          aria-invalid={flagged}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void save()}
          style={{ width: "100%", boxSizing: "border-box", borderColor: flagged ? "#b00020" : undefined }}
        />
      </label>
      <Warnings messages={line.problems} />
      {problem !== null && <p role="alert" style={{ color: "#b00020", margin: "0.25rem 0 0" }}>{problem}</p>}
    </div>
  );
}

/** How many lines are flagged: the number "Make the Ode" waits on. */
function flaggedCount(lyrics: Lyrics): number {
  const lines = [...lyrics.verses.flatMap((verse) => verse.lines), ...(lyrics.hook ? [lyrics.hook] : []), ...(lyrics.chorus ? [lyrics.chorus] : [])];
  return lines.filter((line) => line.problems.length > 0).length;
}

/**
 * The lyrics preview: write the lyrics from the ledger, read them, and edit any line.
 *
 * @param onFlagged - Called with how many lines are flagged, each time the lyrics are loaded or change.
 */
export function LyricsPreview({ onFlagged }: { onFlagged: (count: number) => void }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  // Bumped whenever all lyrics are replaced, so line fields restart from the server's text.
  const [generation, setGeneration] = useState(0);

  // Report the flagged count, and zero once this preview goes away so a stale count never blocks the button.
  useEffect(() => {
    if (load.status === "ready") onFlagged(flaggedCount(load.lyrics));
  }, [load]);
  useEffect(() => () => onFlagged(0), []);

  useEffect(() => {
    fetch("/api/lyrics")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((lyrics: Lyrics) => setLoad({ status: "ready", lyrics }))
      .catch(() => setLoad({ status: "error" }));
  }, []);

  async function write() {
    const hasLyrics = load.status === "ready" && load.lyrics.hook !== null;
    if (hasLyrics && !window.confirm("Writing new lyrics replaces the current ones, including your edits. Continue?")) return;
    setWriting(true);
    setWriteError(null);
    try {
      const res = await fetch("/api/lyrics", { method: "POST" });
      if (!res.ok) return setWriteError(await failureMessage(res));
      const lyrics: Lyrics = await res.json();
      setGeneration((g) => g + 1);
      setLoad({ status: "ready", lyrics });
    } catch {
      setWriteError("Couldn’t reach Ode. Check your connection and try again.");
    } finally {
      setWriting(false);
    }
  }

  function saved(target: Target, line: Line) {
    setLoad((current) => (current.status === "ready" ? { status: "ready", lyrics: withLine(current.lyrics, target, line) } : current));
  }

  const written = load.status === "ready" && load.lyrics.hook !== null && load.lyrics.chorus !== null ? { ...load.lyrics, hook: load.lyrics.hook, chorus: load.lyrics.chorus } : undefined;

  return (
    <section>
      <h2>Lyrics</h2>
      {load.status === "loading" && <p>Loading…</p>}
      {load.status === "error" && <p>Couldn’t load your lyrics. Try again in a moment.</p>}
      {load.status === "ready" && (
        <button onClick={() => void write()} disabled={writing}>
          {writing ? "Writing your lyrics…" : written ? "Write new lyrics" : "Write the lyrics"}
        </button>
      )}
      {writeError !== null && <p role="alert" style={{ color: "#b00020" }}>{writeError}</p>}

      {written && (
        <div key={generation}>
          {written.verses.map((verse) => (
            <fieldset key={verse.friend} style={{ marginTop: "1rem" }}>
              <legend>{verse.friend}</legend>
              {verse.lines.map((line, index) => {
                const target: Target = { kind: "verse", friend: verse.friend, index };
                return (
                  <LineField
                    key={index}
                    label={`Line ${index + 1}`}
                    line={line}
                    target={target}
                    onSaved={(updated) => saved(target, updated)}
                  />
                );
              })}
            </fieldset>
          ))}
          <fieldset style={{ marginTop: "1rem" }}>
            <legend>Hook and chorus</legend>
            <LineField label="Hook, between the verses" line={written.hook} target={{ kind: "hook" }} onSaved={(line) => saved({ kind: "hook" }, line)} />
            <LineField label="Chorus, at the end" line={written.chorus} target={{ kind: "chorus" }} onSaved={(line) => saved({ kind: "chorus" }, line)} />
          </fieldset>
        </div>
      )}
    </section>
  );
}
