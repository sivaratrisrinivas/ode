import type pg from "pg";
import type { Sql } from "./ports.ts";

/**
 * Adapt a `pg` connection pool to the `Sql` port: the web service and the Workflow task both use it.
 *
 * @param pool - The pool; the caller creates it and ends it.
 * @returns A database whose transactions hold one connection from begin to commit or rollback.
 */
export function createPostgresSql(pool: pg.Pool): Sql {
  return {
    query: (text, params) => pool.query(text, params),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await work(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
