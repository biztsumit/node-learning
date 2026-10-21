import pool from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { withTransaction } from "../db/transaction.js";
import { AppError } from "../utils/app-error.js";
import { canChangeStatus } from "../utils/order-status.js";
import { orderNumbers } from "../utils/order-number.js";
import { PG_UNIQUE_VIOLATION } from "../utils/db-errors.js";
import { enqueue } from "../jobs/queue.js";
import { getAddress } from "./address.services.js";
import { processRefund, requestRefund } from "./refund.services.js";
import { optionsLabel } from "./variant.services.js";

// ---------- Reading orders ----------

// Turns the order row + its item rows into the shape the API sends back
const toOrder = (order, items, { includeCustomer }) => ({
  id: order.id,
  // What customers see and quote ("ORD-7K3M9Q"); the id is for the API
  orderNumber: order.order_number,
  status: order.status,
  totalAmount: order.total_amount,
  createdAt: order.created_at,
  updatedAt: order.updated_at,
  // Pending orders must be paid by this time, or they're cancelled and their stock released
  expiresAt: order.status === "pending"
    ? new Date(order.created_at.getTime() + env.ORDER_PAYMENT_TIMEOUT_MINUTES * 60_000)
    : null,
  cancelReason: order.cancel_reason,
  // The latest refund for this order, if any (amount in rupees, like totalAmount)
  refund: order.refund
    ? { status: order.refund.status, amount: order.refund.amount / 100, requestedAt: order.refund.requested_at }
    : null,
  shippingAddress: order.shipping_address,
  ...(includeCustomer && {
    customer: { id: order.user_id, name: order.user_name, email: order.user_email }
  }),
  items: items.map((item) => ({
    productId: item.product_id,
    variantId: item.variant_id,
    productName: item.product_name,
    // What was chosen, as it was at the time of the order (snapshot)
    options: item.variant_options,
    optionsLabel: optionsLabel(item.variant_options),
    sku: item.sku,
    unitPrice: item.unit_price,
    quantity: item.quantity,
    lineTotal: item.line_total
  }))
});

// Pass userId to only find that user's order (customers);
// leave it out to find any order (admins), which also adds the customer's details.
export const getOrderById = async (orderId, { userId } = {}) => {

  const values = [orderId];
  let ownerFilter = "";

  if (userId !== undefined) {
    values.push(userId);
    ownerFilter = "AND o.user_id = $2";
  }

  const { rows: orders } = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.total_amount, o.created_at, o.updated_at, o.shipping_address, o.cancel_reason,
            (SELECT json_build_object('status', r.status, 'amount', r.amount, 'requested_at', r.created_at)
             FROM refunds r JOIN payments p ON p.id = r.payment_id
             WHERE p.order_id = o.id
             ORDER BY r.created_at DESC
             LIMIT 1) AS refund,
            u.id AS user_id, u.name AS user_name, u.email AS user_email
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.id = $1 ${ownerFilter}`,
    values
  );

  if (orders.length === 0) {
    return undefined;
  }

  const { rows: items } = await pool.query(
    `SELECT product_id, variant_id, product_name, variant_options, sku, unit_price, quantity, line_total
     FROM order_items
     WHERE order_id = $1
     ORDER BY id`,
    [orderId]
  );

  return toOrder(orders[0], items, { includeCustomer: userId === undefined });
};

// Finds an order by its number ("ORD-7K3M9Q"). Same ownership rule as getOrderById.
export const getOrderByNumber = async (orderNumber, { userId } = {}) => {
  const { rows } = await pool.query("SELECT id FROM orders WHERE order_number = $1", [orderNumber]);
  return rows[0] && getOrderById(rows[0].id, { userId });
};

// A page of orders, newest first. Same rule: pass userId for one customer's orders only.
export const listOrders = async ({ userId, status, orderNumber, page, limit }, { includeCustomer = false } = {}) => {

  const conditions = [];
  const values = [];
  const addValue = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (userId !== undefined) {
    conditions.push(`o.user_id = ${addValue(userId)}`);
  }
  if (status !== undefined) {
    conditions.push(`o.status = ${addValue(status)}`);
  }
  if (orderNumber !== undefined) {
    conditions.push(`o.order_number = ${addValue(orderNumber)}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * limit;

  const [rowsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT o.id, o.order_number, o.status, o.total_amount, o.created_at,
              u.id AS user_id, u.name AS user_name, u.email AS user_email,
              (SELECT COALESCE(SUM(oi.quantity), 0)::int
               FROM order_items oi
               WHERE oi.order_id = o.id) AS item_count
       FROM orders o
       JOIN users u ON u.id = o.user_id
       ${where}
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM orders o ${where}`, values)
  ]);

  const total = countResult.rows[0].total;

  return {
    orders: rowsResult.rows.map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      totalAmount: row.total_amount,
      itemCount: row.item_count,
      createdAt: row.created_at,
      ...(includeCustomer && {
        customer: { id: row.user_id, name: row.user_name, email: row.user_email }
      })
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
};

// ---------- Placing an order ----------

// Inserts the order with a new random order number. If the number happens to be taken
// (about 1 in a million per order at 600 orders, rarer with fewer), try another.
//
// A failed statement normally ruins the whole transaction ("current transaction is aborted").
// A SAVEPOINT is a bookmark inside it: ROLLBACK TO SAVEPOINT undoes just the failed insert,
// and the rest of the checkout (locked cart, checked stock) carries on.
const insertOrderWithNumber = async (client, [userId, totalAmount, shippingAddress]) => {
  for (let attempt = 1; ; attempt++) {
    await client.query("SAVEPOINT order_number");
    try {
      const { rows: [order] } = await client.query(
        `INSERT INTO orders (user_id, total_amount, shipping_address, order_number)
         VALUES ($1, $2, $3, $4)
         RETURNING id, order_number`,
        [userId, totalAmount, shippingAddress, orderNumbers.next()]
      );
      await client.query("RELEASE SAVEPOINT order_number");
      return order;
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT order_number");
      const numberTaken = err.code === PG_UNIQUE_VIOLATION && err.constraint === "orders_order_number_key";
      if (!numberTaken || attempt >= 5) {
        throw err;
      }
      logger.warn({ attempt }, "Order number already taken, trying another");
    }
  }
};

// Finds the address to ship to: the one the user picked, or else their default.
// Always filtered by userId, so nobody can ship to (and read) someone else's address.
const findShippingAddress = async (client, userId, addressId) => {
  const address = addressId !== undefined
    ? await getAddress(userId, addressId, client)
    : await getDefaultAddress(client, userId);

  if (!address) {
    throw addressId !== undefined
      ? new AppError(404, "Address not found")
      : new AppError(400, "Add a shipping address first, or send an addressId");
  }

  // The snapshot stored on the order: the address as it is right now
  const { id, label, isDefault, ...snapshot } = address;
  return snapshot;
};

const getDefaultAddress = async (client, userId) => {
  const { rows } = await client.query(
    "SELECT id FROM addresses WHERE user_id = $1 AND is_default",
    [userId]
  );
  return rows[0] && getAddress(userId, rows[0].id, client);
};

// Turns the user's cart into an order. All steps run in ONE transaction:
// if anything fails (e.g. not enough stock), nothing is saved and the cart stays as it was.
export const checkout = async (userId, { addressId } = {}) => {

  const orderId = await withTransaction(async (client) => {

    // 0. Where is it going? (fails early if there's no usable address)
    const shippingAddress = await findShippingAddress(client, userId, addressId);

    // 1. Read the cart and LOCK the product rows (and cart rows) involved.
    //    Another checkout that wants the same products now has to wait until we finish,
    //    so two customers can't both buy the last item.
    //    ORDER BY p.id: everyone locks products in the same order, which prevents deadlocks.
    //    Stock lives on the VARIANT, and changing it makes a trigger update the product's
    //    summary row too. So this locks the cart lines, the products AND the variants, all
    //    in one fixed order (product, then variant): two checkouts can never hold locks the
    //    other one is waiting for (no deadlocks).
    const { rows: cart } = await client.query(
      `SELECT
         ci.product_id,
         ci.variant_id,
         ci.quantity,
         p.name,
         v.price,
         v.stock,
         v.options,
         v.sku
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       JOIN product_variants v ON v.id = ci.variant_id
       WHERE ci.user_id = $1
       ORDER BY p.id, v.id
       FOR UPDATE`,
      [userId]
    );

    if (cart.length === 0) {
      throw new AppError(400, "Your cart is empty");
    }

    // 2. Check stock for every item, and report all problems at once
    const problems = cart
      .filter((item) => item.quantity > item.stock)
      .map((item) => {
        const label = optionsLabel(item.options);
        const name = label ? `${item.name} (${label})` : item.name;
        return {
          field: `variantId:${item.variant_id}`,
          message: item.stock === 0
            ? `"${name}" is out of stock`
            : `Only ${item.stock} of "${name}" left (you have ${item.quantity} in your cart)`
        };
      });

    if (problems.length > 0) {
      throw new AppError(409, "Some items in your cart are no longer available", problems);
    }

    // 3. Create the order. The total is calculated here, from database prices.
    const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const order = await insertOrderWithNumber(client, [userId, totalAmount, shippingAddress]);

    // Queued inside the transaction: if anything below fails, there's no "order placed" email
    await enqueue("order-email", { orderId: order.id, type: "placed" }, { client });

    for (const item of cart) {
      // 4. Copy the product's name, the chosen options, SKU and price into the order (the snapshot)
      await client.query(
        `INSERT INTO order_items
           (order_id, product_id, variant_id, product_name, variant_options, sku, unit_price, quantity, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [order.id, item.product_id, item.variant_id, item.name, item.options, item.sku,
          item.price, item.quantity, item.price * item.quantity]
      );

      // 5. Take the items out of stock (the trigger updates the product's total)
      await client.query(
        "UPDATE product_variants SET stock = stock - $1 WHERE id = $2",
        [item.quantity, item.variant_id]
      );
    }

    // 6. Empty the cart
    await client.query("DELETE FROM cart_items WHERE user_id = $1", [userId]);

    return order.id;
  });

  return getOrderById(orderId, { userId });
};

// ---------- Changing an order's status ----------

// Reads the order and LOCKS it until the transaction ends, so two status changes
// on the same order (e.g. a double-clicked "Cancel") run one after the other.
const lockOrder = async (client, orderId, userId) => {
  const values = [orderId];
  let ownerFilter = "";

  if (userId !== undefined) {
    values.push(userId);
    ownerFilter = "AND user_id = $2";
  }

  const { rows } = await client.query(
    `SELECT id, status FROM orders WHERE id = $1 ${ownerFilter} FOR UPDATE`,
    values
  );
  return rows[0];
};

// Puts a cancelled order's items back in stock
const restoreStock = async (client, orderId) => {
  // Lock the products and variants first, in the same order checkout uses (prevents deadlocks)
  const { rows: lines } = await client.query(
    `SELECT v.id AS variant_id, oi.quantity
     FROM order_items oi
     JOIN product_variants v ON v.id = oi.variant_id
     JOIN products p ON p.id = v.product_id
     WHERE oi.order_id = $1
     ORDER BY p.id, v.id
     FOR UPDATE OF p, v`,
    [orderId]
  );

  // One variant at a time, in that order. Lines whose variant was deleted (variant_id NULL)
  // aren't in the list: there's nothing to put the stock back into.
  for (const line of lines) {
    await client.query(
      "UPDATE product_variants SET stock = stock + $1 WHERE id = $2",
      [line.quantity, line.variant_id]
    );
  }
};

// cancelReason: who/what cancelled it ("customer", "admin" or "payment_timeout")
const applyStatus = async (client, orderId, newStatus, { cancelReason = null } = {}) => {
  if (newStatus === "cancelled") {
    await restoreStock(client, orderId);
  }

  await client.query(
    "UPDATE orders SET status = $1, cancel_reason = $3, updated_at = NOW() WHERE id = $2",
    [newStatus, orderId, newStatus === "cancelled" ? cancelReason : null]
  );

  // Part of this transaction: sent only if the change is saved
  await enqueue("order-email", { orderId, type: newStatus }, { client });
};

// A customer cancelling their own order: only while it's still pending
export const cancelOrder = async (userId, orderId) => {

  await withTransaction(async (client) => {

    const order = await lockOrder(client, orderId, userId);

    if (!order) {
      throw new AppError(404, "Order not found");
    }
    if (order.status !== "pending") {
      throw new AppError(409, `Only pending orders can be cancelled. This order is ${order.status}`);
    }

    await applyStatus(client, orderId, "cancelled", { cancelReason: "customer" });
  });

  return getOrderById(orderId, { userId });
};

// An admin moving an order along: pending → paid → shipped → delivered, or cancelling it
export const changeOrderStatus = async (orderId, newStatus) => {

  const refundId = await withTransaction(async (client) => {

    const order = await lockOrder(client, orderId);

    if (!order) {
      throw new AppError(404, "Order not found");
    }
    if (!canChangeStatus(order.status, newStatus)) {
      throw new AppError(409, `Can't change an order from "${order.status}" to "${newStatus}"`);
    }

    await applyStatus(client, orderId, newStatus, { cancelReason: "admin" });

    // Cancelling an order the customer already paid for: give the money back.
    // (Orders marked "paid" by hand, e.g. cash, have no online payment and get no refund.)
    if (order.status === "paid" && newStatus === "cancelled") {
      const { rows: [payment] } = await client.query(
        "SELECT id FROM payments WHERE order_id = $1 AND status = 'paid' LIMIT 1",
        [orderId]
      );
      if (payment) {
        return requestRefund(client, payment.id, "order_cancelled");
      }
    }
    return null;
  });

  // After the commit: send the refund to Razorpay (on failure the job retries it)
  if (refundId) {
    await processRefund(refundId);
  }

  return getOrderById(orderId);
};

// ---------- Expiring unpaid orders (run by a background job) ----------

// Cancels pending orders older than the payment timeout and puts their stock back.
// Returns the ids it cancelled.
//
// Safe to run on several servers at the same moment: "FOR UPDATE SKIP LOCKED" means
// "lock one expired order that NOBODY ELSE has locked; skip the ones that are busy".
// So two jobs never pick the same order, and a job never waits behind a customer who's
// cancelling (or paying for) that order right now.
//
// One order per transaction: each order's stock is released as soon as it's done, a
// problem with one order doesn't undo the others, and locks are held only briefly.
export const expireUnpaidOrders = async ({ maxOrders = 100 } = {}) => {

  const expired = [];

  while (expired.length < maxOrders) {
    const orderId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id FROM orders
         WHERE status = 'pending'
           AND created_at < NOW() - make_interval(mins => $1)
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [env.ORDER_PAYMENT_TIMEOUT_MINUTES]
      );

      if (rows.length === 0) {
        return null;
      }

      await applyStatus(client, rows[0].id, "cancelled", { cancelReason: "payment_timeout" });
      return rows[0].id;
    });

    if (!orderId) {
      break;
    }

    logger.info({ orderId }, "Cancelled unpaid order: payment time ran out, stock released");
    expired.push(orderId);
  }

  return expired;
};
