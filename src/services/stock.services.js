// The stock ledger: why stock changed. The database records every change itself (a trigger
// on product_variants); this file tells it the reason, and lets admins adjust and read it.
import pool from "../config/db.js";
import { withTransaction } from "../db/transaction.ts";
import { AppError } from "../utils/app-error.ts";
import { setStockContext } from "../db/stock-context.ts";
import { optionsLabel } from "./variant.services.js";
import { pagedQuery, timestampKey } from "../utils/cursor.ts";

// POST /admin/stock-movements: "10 arrived", "2 broke". A CHANGE (+10 / -2), not a new total:
// stock = stock + change works even if a checkout sells some at the same moment,
// while "set it to 15" would quietly undo that sale.
export const adjustStock = ({ variantId, change, reason, note }, adminId) =>
  withTransaction(async (client) => {
    // Lock product, then variant: the same order as checkout (no deadlocks)
    const { rows } = await client.query(
      `SELECT v.id, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.id = $1 FOR UPDATE OF p, v`,
      [variantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, "Variant not found");
    }
    if (rows[0].stock + change < 0) {
      throw new AppError(409, `Only ${rows[0].stock} in stock: can't take away ${-change}`);
    }

    await setStockContext(client, { reason, userId: adminId, note });
    await client.query("UPDATE product_variants SET stock = stock + $1 WHERE id = $2", [change, variantId]);

    const { rows: [movement] } = await client.query(
      `${SELECT_MOVEMENTS} WHERE m.variant_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
      [variantId]
    );
    return toMovement(movement);
  });

const MOVEMENT_COLUMNS = `
  SELECT m.id, m.variant_id, m.product_id, m.change, m.stock_after, m.reason, m.note, m.created_at,
         ${timestampKey("m.created_at")} AS created_key,
         m.order_id, o.order_number, m.user_id, u.name AS user_name,
         p.name AS product_name, v.options, v.sku`;

const MOVEMENT_FROM = `
  FROM stock_movements m
  LEFT JOIN products p ON p.id = m.product_id
  LEFT JOIN product_variants v ON v.id = m.variant_id
  LEFT JOIN orders o ON o.id = m.order_id
  LEFT JOIN users u ON u.id = m.user_id
`;

const SELECT_MOVEMENTS = `${MOVEMENT_COLUMNS} ${MOVEMENT_FROM}`;

const toMovement = (row) => ({
  id: row.id,
  productId: row.product_id,
  variantId: row.variant_id,
  // NULL when the product/variant has since been deleted (the history stays)
  productName: row.product_name,
  optionsLabel: row.options ? optionsLabel(row.options) : null,
  sku: row.sku,
  change: row.change,
  stockAfter: row.stock_after,
  reason: row.reason,
  note: row.note,
  order: row.order_id ? { id: row.order_id, orderNumber: row.order_number } : null,
  by: row.user_id ? { id: row.user_id, name: row.user_name } : null,
  createdAt: row.created_at
});

// GET /admin/stock-movements?productId=&variantId=&orderId=&reason=  (newest first)
const MOVEMENT_SORT = {
  name: "stock",
  direction: "desc",
  keys: [
    { column: "m.created_at", type: "timestamptz", value: (row) => row.created_key },
    { column: "m.id", type: "uuid", value: (row) => row.id }
  ]
};

// The ledger only ever grows: cursor paging keeps "load older" fast however long it gets
export const listStockMovements = async ({ productId, variantId, orderId, reason, page, cursor, limit }) => {
  const conditions = [];
  const values = [];
  const addValue = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (productId !== undefined) {
    conditions.push(`m.product_id = ${addValue(productId)}`);
  }
  if (variantId !== undefined) {
    conditions.push(`m.variant_id = ${addValue(variantId)}`);
  }
  if (orderId !== undefined) {
    conditions.push(`m.order_id = ${addValue(orderId)}`);
  }
  if (reason !== undefined) {
    conditions.push(`m.reason = ${addValue(reason)}`);
  }
  const { rows, pagination } = await pagedQuery(pool, {
    select: MOVEMENT_COLUMNS,
    from: MOVEMENT_FROM,
    conditions, values, addValue, sort: MOVEMENT_SORT, page, cursor, limit
  });
  return { movements: rows.map(toMovement), pagination };
};
