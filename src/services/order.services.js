import pool from "../config/db.js";
import { withTransaction } from "../db/transaction.js";
import { AppError } from "../utils/app-error.js";
import { canChangeStatus } from "../utils/order-status.js";

// ---------- Reading orders ----------

// Turns the order row + its item rows into the shape the API sends back
const toOrder = (order, items, { includeCustomer }) => ({
  id: order.id,
  status: order.status,
  totalAmount: order.total_amount,
  createdAt: order.created_at,
  updatedAt: order.updated_at,
  ...(includeCustomer && {
    customer: { id: order.user_id, name: order.user_name, email: order.user_email }
  }),
  items: items.map((item) => ({
    productId: item.product_id,
    productName: item.product_name,
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
    `SELECT o.id, o.status, o.total_amount, o.created_at, o.updated_at,
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
    `SELECT product_id, product_name, unit_price, quantity, line_total
     FROM order_items
     WHERE order_id = $1
     ORDER BY id`,
    [orderId]
  );

  return toOrder(orders[0], items, { includeCustomer: userId === undefined });
};

// A page of orders, newest first. Same rule: pass userId for one customer's orders only.
export const listOrders = async ({ userId, status, page, limit }, { includeCustomer = false } = {}) => {

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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * limit;

  const [rowsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT o.id, o.status, o.total_amount, o.created_at,
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

// Turns the user's cart into an order. All steps run in ONE transaction:
// if anything fails (e.g. not enough stock), nothing is saved and the cart stays as it was.
export const checkout = async (userId) => {

  const orderId = await withTransaction(async (client) => {

    // 1. Read the cart and LOCK the product rows (and cart rows) involved.
    //    Another checkout that wants the same products now has to wait until we finish,
    //    so two customers can't both buy the last item.
    //    ORDER BY p.id: everyone locks products in the same order, which prevents deadlocks.
    const { rows: cart } = await client.query(
      `SELECT
         ci.product_id,
         ci.quantity,
         p.name,
         p.price,
         p.stock
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.user_id = $1
       ORDER BY p.id
       FOR UPDATE`,
      [userId]
    );

    if (cart.length === 0) {
      throw new AppError(400, "Your cart is empty");
    }

    // 2. Check stock for every item, and report all problems at once
    const problems = cart
      .filter((item) => item.quantity > item.stock)
      .map((item) => ({
        field: `productId:${item.product_id}`,
        message: item.stock === 0
          ? `"${item.name}" is out of stock`
          : `Only ${item.stock} of "${item.name}" left (you have ${item.quantity} in your cart)`
      }));

    if (problems.length > 0) {
      throw new AppError(409, "Some items in your cart are no longer available", problems);
    }

    // 3. Create the order. The total is calculated here, from database prices.
    const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const { rows: [order] } = await client.query(
      "INSERT INTO orders (user_id, total_amount) VALUES ($1, $2) RETURNING id",
      [userId, totalAmount]
    );

    for (const item of cart) {
      // 4. Copy each product's name and price into the order (the snapshot)
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.product_id, item.name, item.price, item.quantity, item.price * item.quantity]
      );

      // 5. Take the items out of stock
      await client.query(
        "UPDATE products SET stock = stock - $1 WHERE id = $2",
        [item.quantity, item.product_id]
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
  // Lock the products first, in id order, like checkout does (prevents deadlocks)
  await client.query(
    `SELECT p.id
     FROM products p
     JOIN order_items oi ON oi.product_id = p.id
     WHERE oi.order_id = $1
     ORDER BY p.id
     FOR UPDATE OF p`,
    [orderId]
  );

  // Items whose product was deleted have product_id NULL, so they're simply skipped
  await client.query(
    `UPDATE products p
     SET stock = p.stock + oi.quantity
     FROM order_items oi
     WHERE oi.order_id = $1 AND p.id = oi.product_id`,
    [orderId]
  );
};

const applyStatus = async (client, orderId, newStatus) => {
  if (newStatus === "cancelled") {
    await restoreStock(client, orderId);
  }

  await client.query(
    "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2",
    [newStatus, orderId]
  );
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

    await applyStatus(client, orderId, "cancelled");
  });

  return getOrderById(orderId, { userId });
};

// An admin moving an order along: pending → paid → shipped → delivered, or cancelling it
export const changeOrderStatus = async (orderId, newStatus) => {

  await withTransaction(async (client) => {

    const order = await lockOrder(client, orderId);

    if (!order) {
      throw new AppError(404, "Order not found");
    }
    if (!canChangeStatus(order.status, newStatus)) {
      throw new AppError(409, `Can't change an order from "${order.status}" to "${newStatus}"`);
    }

    await applyStatus(client, orderId, newStatus);
  });

  return getOrderById(orderId);
};
