import type { PaymentStore } from "./payments.ts";
import { ownerOfRow, type Owner } from "./owner.ts";
import type { Sql } from "./ports.ts";
import { parseVisitorId } from "./visitor-id.ts";

/**
 * Create the Postgres payment store for one owner's Ode.
 *
 * @param sql - The database.
 * @param owner - Whose Ode the payments are against; payments to another owner's friends are not counted, even to a friend of the same name.
 * @returns A store backed by the `payments` and `payment_orders` tables.
 */
export function createPaymentStore(sql: Sql, owner: Owner): PaymentStore {
  return {
    async totals(visitor) {
      const { rows } = await sql.query<{ friend: string; total: string }>(
        "select friend, sum(amount_cents) as total from payments where owner = $1 and visitor = $2 group by friend",
        [owner, visitor],
      );
      // sum() of integers is a bigint, which the driver returns as text.
      return new Map(rows.map((row) => [row.friend, Number(row.total)]));
    },

    async record({ visitor, captureId, orderId, friend, amountCents }) {
      await sql.query(
        "insert into payments (capture_id, owner, order_id, visitor, friend, amount_cents) values ($1, $2, $3, $4, $5, $6) on conflict (capture_id) do nothing",
        [captureId, owner, orderId, visitor, friend, amountCents],
      );
    },

    async recordOrder(orderId, visitor) {
      await sql.query("insert into payment_orders (order_id, visitor, owner) values ($1, $2, $3) on conflict (order_id) do nothing", [orderId, visitor, owner]);
    },

    async orderVisitor(orderId) {
      const { rows } = await sql.query<{ visitor: string }>("select visitor from payment_orders where order_id = $1 and owner = $2", [orderId, owner]);
      if (rows[0] === undefined) return undefined;
      const visitor = parseVisitorId(rows[0].visitor);
      // Defect: only this store writes visitor, and it writes a VisitorId.
      if (visitor._tag === "err") throw new Error(`corrupt payment_orders row: ${rows[0].visitor} is not a visitor ID`);
      return visitor.value;
    },

    async reset(visitor) {
      await sql.query("delete from payments where owner = $1 and visitor = $2", [owner, visitor]);
      await sql.query("delete from payment_orders where owner = $1 and visitor = $2", [owner, visitor]);
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

/**
 * Find which Ode a PayPal order was made for, across every owner: PayPal's webhook says only which order was captured.
 *
 * @param sql - The database.
 * @param orderId - The PayPal order ID.
 * @returns The owner; undefined for an order this app never made, or one forgotten by "Reset demo".
 */
export async function findOrderOwner(sql: Sql, orderId: string): Promise<Owner | undefined> {
  const { rows } = await sql.query<{ owner: string }>("select owner from payment_orders where order_id = $1", [orderId]);
  if (rows[0] === undefined) return undefined;
  return ownerOfRow("payment_orders", rows[0].owner);
}
