import type { LyricsStore } from "./lyrics-service.ts";
import type { LyricLine, Lyrics } from "./lyrics.ts";
import type { Sql } from "./ports.ts";

interface TextRecord {
  text: string;
  problems: string[];
}

interface LineRecord extends TextRecord {
  friend: string;
}

interface RefrainRecord extends TextRecord {
  kind: "hook" | "chorus";
}

function toLine(record: TextRecord): LyricLine {
  return { text: record.text, problems: record.problems };
}

/**
 * Create the Postgres lyrics store.
 *
 * @param sql - The database; `replace` runs in a transaction.
 * @returns A store backed by the `lyric_lines` and `lyric_refrains` tables.
 */
export function createLyricsStore(sql: Sql): LyricsStore {
  return {
    async read() {
      const lines = await sql.query<LineRecord>(
        `select l.friend, l.text, l.problems
         from lyric_lines l join ledger_friends f on f.friend = l.friend
         order by f.position, l.line_no`,
      );
      const refrains = await sql.query<RefrainRecord>("select kind, text, problems from lyric_refrains");
      const hook = refrains.rows.find((r) => r.kind === "hook");
      const chorus = refrains.rows.find((r) => r.kind === "chorus");
      if (hook === undefined || chorus === undefined) return undefined;

      const verses: { friend: string; lines: LyricLine[] }[] = [];
      for (const record of lines.rows) {
        const last = verses.at(-1);
        if (last?.friend === record.friend) last.lines.push(toLine(record));
        else verses.push({ friend: record.friend, lines: [toLine(record)] });
      }
      return { verses, hook: toLine(hook), chorus: toLine(chorus) };
    },

    async replace(lyrics) {
      await sql.transaction(async (tx) => {
        await tx.query("delete from lyric_lines");
        await tx.query("delete from lyric_refrains");
        for (const verse of lyrics.verses) {
          for (const [index, line] of verse.lines.entries()) {
            await tx.query(
              "insert into lyric_lines (friend, line_no, text, problems) values ($1, $2, $3, $4::jsonb)",
              [verse.friend, index + 1, line.text, JSON.stringify(line.problems)],
            );
          }
        }
        for (const [kind, line] of [["hook", lyrics.hook], ["chorus", lyrics.chorus]] as const) {
          await tx.query("insert into lyric_refrains (kind, text, problems) values ($1, $2, $3::jsonb)", [
            kind,
            line.text,
            JSON.stringify(line.problems),
          ]);
        }
      });
    },

    async updateLine(slot, line) {
      const problems = JSON.stringify(line.problems);
      const { rows } =
        slot._tag === "verse"
          ? await sql.query<TextRecord>(
              `update lyric_lines set text = $3, problems = $4::jsonb
               where friend = $1 and line_no = $2 returning text, problems`,
              [slot.friend, slot.line, line.text, problems],
            )
          : await sql.query<TextRecord>(
              `update lyric_refrains set text = $2, problems = $3::jsonb
               where kind = $1 returning text, problems`,
              [slot._tag, line.text, problems],
            );
      return rows[0] === undefined ? undefined : toLine(rows[0]);
    },
  };
}
