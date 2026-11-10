import type { PaymentStore } from "./payments.ts";
import type { Sql } from "./ports.ts";

/**
 * Create the Postgres payment store.
 *
 * @param sql - The database.
 * @returns A store backed by the `payments` table.
 */
export function createPaymentStore(sql: Sql): PaymentStore {
  return {
    async totals() {
      const { rows } = await sql.query<{ friend: string; total: string }>("select friend, sum(amount_cents) as total from payments group by friend");
      // sum() of integers is a bigint, which the driver returns as text.
      return new Map(rows.map((row) => [row.friend, Number(row.total)]));
    },

    async record({ captureId, orderId, friend, amountCents }) {
      await sql.query("insert into payments (capture_id, order_id, friend, amount_cents) values ($1, $2, $3, $4) on conflict (capture_id) do nothing", [
        captureId,
        orderId,
        friend,
        amountCents,
      ]);
    },

    async hasCapture(captureId) {
      const { rows } = await sql.query("select 1 from payments where capture_id = $1", [captureId]);
      return rows.length > 0;
    },

    async hasOrder(orderId) {
      const { rows } = await sql.query("select 1 from payments where order_id = $1 limit 1", [orderId]);
      return rows.length > 0;
    },
  };
}
