import type { PaymentStore } from "./payments.ts";
import type { Sql } from "./ports.ts";
import { parseVisitorId } from "./visitor.ts";

/**
 * Create the Postgres payment store.
 *
 * @param sql - The database.
 * @returns A store backed by the `payments` and `payment_orders` tables.
 */
export function createPaymentStore(sql: Sql): PaymentStore {
  return {
    async totals(visitor) {
      const { rows } = await sql.query<{ friend: string; total: string }>(
        "select friend, sum(amount_cents) as total from payments where visitor = $1 group by friend",
        [visitor],
      );
      // sum() of integers is a bigint, which the driver returns as text.
      return new Map(rows.map((row) => [row.friend, Number(row.total)]));
    },

    async record({ visitor, captureId, orderId, friend, amountCents }) {
      await sql.query(
        "insert into payments (capture_id, order_id, visitor, friend, amount_cents) values ($1, $2, $3, $4, $5) on conflict (capture_id) do nothing",
        [captureId, orderId, visitor, friend, amountCents],
      );
    },

    async recordOrder(orderId, visitor) {
      await sql.query("insert into payment_orders (order_id, visitor) values ($1, $2) on conflict (order_id) do nothing", [orderId, visitor]);
    },

    async orderVisitor(orderId) {
      const { rows } = await sql.query<{ visitor: string }>("select visitor from payment_orders where order_id = $1", [orderId]);
      if (rows[0] === undefined) return undefined;
      const visitor = parseVisitorId(rows[0].visitor);
      // Defect: only this store writes visitor, and it writes a VisitorId.
      if (visitor._tag === "err") throw new Error(`corrupt payment_orders row: ${rows[0].visitor} is not a visitor ID`);
      return visitor.value;
    },

    async reset(visitor) {
      await sql.query("delete from payments where visitor = $1", [visitor]);
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
