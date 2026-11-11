import type { OdeRuns, OdeStore } from "./ode-service.ts";
import { makeOde, type Ode, type Section, type TimedLine } from "./ode.ts";
import { parseRunId, parseWorkflowRunId, type OdeFailure, type OdeRun, type OdeStep } from "./ode-run.ts";
import type { Sql } from "./ports.ts";
import { parseReleaseDate } from "./release-date.ts";

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

interface RunRecord {
  run_id: string;
  step: OdeStep;
  started_at: Date;
  workflow_run_id: string | null;
  failure: OdeFailure["_tag"] | null;
  failure_message: string | null;
}

/** A column the table's check constraints guarantee for this kind of row. */
function required<T>(value: T | null, what: string): T {
  // Defect: the schema forbids this, so the row was written by something other than this store.
  if (value === null) throw new Error(`corrupt ode row: ${what} is null`);
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

function toRun(record: RunRecord): OdeRun {
  const run = parseRunId(record.run_id);
  // Defect: only this store writes run_id, and it writes a RunId.
  if (run._tag === "err") throw new Error(`corrupt ode_runs row: ${record.run_id} is not a run ID`);

  if (record.failure === null) {
    const workflowRun = record.workflow_run_id === null ? undefined : parseWorkflowRunId(record.workflow_run_id);
    // Defect: the table forbids an empty workflow_run_id.
    if (workflowRun?._tag === "err") throw new Error("corrupt ode_runs row: workflow_run_id is empty");
    return { _tag: "Making", run: run.value, step: record.step, startedAt: record.started_at, workflowRun: workflowRun?.value };
  }
  const failure: OdeFailure =
    record.failure === "LedgerNotReady"
      ? { _tag: "LedgerNotReady", message: required(record.failure_message, "failure_message") }
      : { _tag: record.failure };
  return { _tag: "Failed", run: run.value, failure };
}

/**
 * Create the Postgres Ode store and run store.
 *
 * @param sql - The database; `save` runs in a transaction.
 * @returns One store backed by the `odes`, `ode_sections`, `ode_lines` and `ode_runs` tables, since saving the Ode and clearing its run are one commit.
 */
export function createOdeStore(sql: Sql): OdeStore & OdeRuns {
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

    async releaseDate() {
      const { rows } = await sql.query<{ release_date: string | null }>("select release_date from odes where id = 1");
      const stored = rows[0]?.release_date ?? null;
      if (stored === null) return undefined;
      // The epoch as "now", so a date that has since passed is still read back; only its shape is checked.
      const parsed = parseReleaseDate(stored, new Date(0));
      // Defect: only this store writes the column, and it writes a parsed release date.
      if (parsed._tag === "err") throw new Error(`corrupt odes row: release_date ${stored} is not a date`);
      return parsed.value;
    },

    async readAudio() {
      const { rows } = await sql.query<{ audio: Uint8Array }>("select audio from odes where id = 1");
      return rows[0]?.audio;
    },

    async save(run, ode: Ode, audio) {
      return sql.transaction(async (tx) => {
        // Locked, so the run cannot be marked failed or replaced between this check and the commit.
        const current = await tx.query<{ release_date: string | null }>(
          "select release_date from ode_runs where id = 1 and run_id = $1 and failure is null for update",
          [run],
        );
        if (current.rows[0] === undefined) return false;

        // Deleting the Ode cascades to its sections and lines; the new one goes in as a whole or not at all.
        await tx.query("delete from odes");
        // The release date set when the run began is the Ode's, and nothing updates it afterwards.
        await tx.query("insert into odes (id, audio, release_date) values (1, $1, $2)", [audio, current.rows[0].release_date]);
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
        await tx.query("delete from ode_runs where id = 1");
        return true;
      });
    },

    async current() {
      const { rows } = await sql.query<RunRecord>(
        "select run_id, step, started_at, workflow_run_id, failure, failure_message from ode_runs where id = 1",
      );
      return rows[0] === undefined ? undefined : toRun(rows[0]);
    },

    async begin(run, startedAt, releaseDate) {
      // A single statement, so concurrent requests cannot both begin, and no run begins over a saved Ode: the
      // conflict clause only replaces a failed run.
      const { rows } = await sql.query(
        `insert into ode_runs (id, run_id, step, started_at, release_date)
         select 1, $1, 'writing', $2, $3 where not exists (select 1 from odes)
         on conflict (id) do update set
           run_id = excluded.run_id, step = 'writing', started_at = excluded.started_at, release_date = excluded.release_date,
           workflow_run_id = null, failure = null, failure_message = null
         where ode_runs.failure is not null
         returning id`,
        [run, startedAt, releaseDate ?? null],
      );
      return rows.length > 0;
    },

    async attach(run, workflowRun) {
      await sql.query("update ode_runs set workflow_run_id = $2 where id = 1 and run_id = $1 and failure is null", [run, workflowRun]);
    },

    async advance(run, step) {
      const { rows } = await sql.query(
        "update ode_runs set step = $2 where id = 1 and run_id = $1 and failure is null returning id",
        [run, step],
      );
      return rows.length > 0;
    },

    async fail(run, failure) {
      const { rows } = await sql.query(
        "update ode_runs set failure = $2, failure_message = $3 where id = 1 and run_id = $1 and failure is null returning id",
        [run, failure._tag, failure._tag === "LedgerNotReady" ? failure.message : null],
      );
      return rows.length > 0;
    },

    async discard(run) {
      await sql.query("delete from ode_runs where id = 1 and run_id = $1 and failure is null", [run]);
    },
  };
}
