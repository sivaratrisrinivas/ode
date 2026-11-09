import type { OdeStore } from "./ode-service.ts";
import { makeOde, type Ode, type Section, type TimedLine } from "./ode.ts";
import type { Sql } from "./ports.ts";

interface SectionRecord {
  position: number;
  kind: Section["kind"];
  friend: string | null;
  text: string | null;
  start_ms: number;
  end_ms: number;
}

interface LineRecord {
  position: number;
  text: string;
  start_ms: number;
  end_ms: number;
}

/** A column the table's check constraints guarantee for this kind of section. */
function required<T>(value: T | null, what: string): T {
  // Defect: the schema forbids this, so the row was written by something other than this store.
  if (value === null) throw new Error(`corrupt ode_sections row: ${what} is null`);
  return value;
}

function toSection(record: SectionRecord, lines: readonly TimedLine[]): Section {
  const window = { startMs: record.start_ms, endMs: record.end_ms };
  switch (record.kind) {
    case "intro":
      return { kind: "intro", ...window };
    case "verse":
      return { kind: "verse", friend: required(record.friend, "friend"), lines, ...window };
    case "hook":
      return { kind: "hook", text: required(record.text, "text"), ...window };
    case "chorus":
      return { kind: "chorus", text: required(record.text, "text"), ...window };
  }
}

/**
 * Create the Postgres Ode store.
 *
 * @param sql - The database; `save` runs in a transaction.
 * @returns A store backed by the `odes`, `ode_sections` and `ode_lines` tables.
 */
export function createOdeStore(sql: Sql): OdeStore {
  return {
    async read() {
      const sections = await sql.query<SectionRecord>(
        "select position, kind, friend, text, start_ms, end_ms from ode_sections order by position",
      );
      if (sections.rows.length === 0) return undefined;
      const lines = await sql.query<LineRecord>(
        "select position, text, start_ms, end_ms from ode_lines order by position, line_no",
      );
      const read = sections.rows.map((record) =>
        toSection(
          record,
          lines.rows
            .filter((line) => line.position === record.position)
            .map((line) => ({ text: line.text, startMs: line.start_ms, endMs: line.end_ms })),
        ),
      );
      return makeOde(read);
    },

    async readAudio() {
      const { rows } = await sql.query<{ audio: Uint8Array }>("select audio from odes where id = 1");
      return rows[0]?.audio;
    },

    async save(ode: Ode, audio) {
      await sql.transaction(async (tx) => {
        // Deleting the Ode cascades to its sections and lines; the new one goes in as a whole or not at all.
        await tx.query("delete from odes");
        await tx.query("insert into odes (id, audio) values (1, $1)", [audio]);
        for (const [position, section] of ode.sections.entries()) {
          await tx.query(
            `insert into ode_sections (position, kind, friend, text, start_ms, end_ms)
             values ($1, $2, $3, $4, $5, $6)`,
            [
              position,
              section.kind,
              section.kind === "verse" ? section.friend : null,
              section.kind === "hook" || section.kind === "chorus" ? section.text : null,
              section.startMs,
              section.endMs,
            ],
          );
          if (section.kind !== "verse") continue;
          for (const [index, line] of section.lines.entries()) {
            await tx.query(
              "insert into ode_lines (position, line_no, text, start_ms, end_ms) values ($1, $2, $3, $4, $5)",
              [position, index + 1, line.text, line.startMs, line.endMs],
            );
          }
        }
      });
    },
  };
}
