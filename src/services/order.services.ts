import type { PoolClient } from "pg";
import pool from "../config/db.ts";
import { env } from "../config/env.ts";
import { logger } from "../config/logger.ts";
import { withTransaction, type TransactionClient } from "../db/transaction.ts";
import { AppError, type FieldError } from "../utils/app-error.ts";
import { canChangeStatus, type OrderStatus } from "../utils/order-status.ts";
import { orderNumbers } from "../utils/order-number.ts";
import { PG_UNIQUE_VIOLATION, isDatabaseError } from "../utils/db-errors.ts";
import { enqueue } from "../jobs/queue.ts";
import { getAddress, type Address } from "./address.services.ts";
import { processRefund, requestRefund } from "./refund.services.ts";
import { optionsLabel, type VariantOptions } from "./variant.services.ts";
import { releaseCoupon, recordRedemption, reserveCoupon } from "./coupon.services.ts";
import { setStockContext } from "../db/stock-context.ts";
import { pagedQuery, timestampKey, type Pagination, type Sort } from "../utils/cursor.ts";
import type { AdminOrderListQuery, Checkout } from "../validators/order.validators.ts";

// Who or what cancelled an order (the order emails explain each one to the customer)
export type CancelReason = "customer" | "admin" | "payment_timeout";

// The address saved on the order: as it was when ordered (without the address book's own fields)
export type ShippingAddress = Omit<Address, "id" | "label" | "isDefault">;

type OrderRow = {
  id: string;
  order_number: string;
  status: OrderStatus;
  subtotal_amount: number;
  discount_amount: number;
  coupon_code: string | null;
  total_amount: number;
  created_at: Date;
  updated_at: Date;
  shipping_address: ShippingAddress;           // JSONB arrives already parsed
  cancel_reason: CancelReason | null;
  refund: { status: string; amount: number; requested_at: string } | null;
  user_id: string;
  user_name: string;
  user_email: string;
};

type OrderItemRow = {
  product_id: string | null;                   // NULL once the product is deleted
  variant_id: string | null;
  product_name: string;
  variant_options: VariantOptions;
  sku: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
};

export type OrderItem = {
  productId: string | null;
  variantId: string | null;
  productName: string;
  options: VariantOptions;
  optionsLabel: string;
  sku: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type Customer = { id: string; name: string; email: string };

export type Order = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  subtotalAmount: number;
  discountAmount: number;
  couponCode: string | null;
  totalAmount: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  cancelReason: CancelReason | null;
  refund: { status: string; amount: number; requestedAt: string } | null;
  shippingAddress: ShippingAddress;
  customer?: Customer;                         // admins only
  items: OrderItem[];
};

// ---------- Reading orders ----------

// Turns the order row + its item rows into the shape the API sends back
const toOrder = (order: OrderRow, items: OrderItemRow[], { includeCustomer }: { includeCustomer: boolean }): Order => ({
  id: order.id,
  // What customers see and quote ("ORD-7K3M9Q"); the id is for the API
  orderNumber: order.order_number,
  status: order.status,
  // subtotal (the items) - discount (the coupon) = total (what is paid)
  subtotalAmount: order.subtotal_amount,
  discountAmount: order.discount_amount,
  couponCode: order.coupon_code,
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
export const getOrderById = async (orderId: string, { userId }: { userId?: string } = {}): Promise<Order | undefined> => {

  const values: string[] = [orderId];
  let ownerFilter = "";

  if (userId !== undefined) {
    values.push(userId);
    ownerFilter = "AND o.user_id = $2";
  }

  const { rows: [order] } = await pool.query<OrderRow>(
    `SELECT o.id, o.order_number, o.status, o.subtotal_amount, o.discount_amount, o.coupon_code, o.total_amount,
            o.created_at, o.updated_at, o.shipping_address, o.cancel_reason,
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

  if (!order) {
    return undefined;
  }

  const { rows: items } = await pool.query<OrderItemRow>(
    `SELECT product_id, variant_id, product_name, variant_options, sku, unit_price, quantity, line_total
     FROM order_items
     WHERE order_id = $1
     ORDER BY id`,
    [orderId]
  );

  return toOrder(order, items, { includeCustomer: userId === undefined });
};

// Finds an order by its number ("ORD-7K3M9Q"). Same ownership rule as getOrderById.
export const getOrderByNumber = async (orderNumber: string, { userId }: { userId?: string } = {}): Promise<Order | undefined> => {
  const { rows: [found] } = await pool.query<{ id: string }>("SELECT id FROM orders WHERE order_number = $1", [orderNumber]);
  return found && getOrderById(found.id, { userId });
};

// Newest first. The id breaks ties between orders placed in the same microsecond.
const ORDER_SORT: Sort = {
  name: "orders",
  direction: "desc",
  keys: [
    { column: "o.created_at", type: "timestamptz", value: (row) => row.created_key },
    { column: "o.id", type: "uuid", value: (row) => row.id }
  ]
};

type OrderSummaryRow = {
  id: string;
  order_number: string;
  status: OrderStatus;
  total_amount: number;
  created_at: Date;
  user_id: string;
  user_name: string;
  user_email: string;
  item_count: number;
};

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: number;
  itemCount: number;
  createdAt: Date;
  customer?: Customer;
};

// A page of orders, newest first. Same rule: pass userId for one customer's orders only.
// The admin query type covers both: customers just never send userId/orderNumber.
export const listOrders = async (
  { userId, status, orderNumber, page, cursor, limit }: Partial<AdminOrderListQuery> & Pick<AdminOrderListQuery, "limit">,
  { includeCustomer = false }: { includeCustomer?: boolean } = {}
): Promise<{ orders: OrderSummary[]; pagination: Pagination }> => {

  const conditions: string[] = [];
  const values: unknown[] = [];
  const addValue = (value: unknown): string => {
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

  const { rows, pagination } = await pagedQuery(pool, {
    select: `SELECT o.id, o.order_number, o.status, o.total_amount, o.created_at, ${timestampKey("o.created_at")} AS created_key,
              u.id AS user_id, u.name AS user_name, u.email AS user_email,
              (SELECT COALESCE(SUM(oi.quantity), 0)::int
               FROM order_items oi
               WHERE oi.order_id = o.id) AS item_count`,
    from: "FROM orders o JOIN users u ON u.id = o.user_id",
    conditions, values, addValue, sort: ORDER_SORT, page, cursor, limit
  });

  return {
    orders: (rows as OrderSummaryRow[]).map((row) => ({
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
    pagination
  };
};

// ---------- Placing an order ----------

type NewOrder = {
  userId: string;
  subtotal: number;
  discount: number;
  couponCode: string | null;
  shippingAddress: ShippingAddress;
};

// Inserts the order with a new random order number. If the number happens to be taken
// (about 1 in a million per order at 600 orders, rarer with fewer), try another.
//
// A failed statement normally ruins the whole transaction ("current transaction is aborted").
// A SAVEPOINT is a bookmark inside it: ROLLBACK TO SAVEPOINT undoes just the failed insert,
// and the rest of the checkout (locked cart, checked stock) carries on.
const insertOrderWithNumber = async (
  client: PoolClient,
  { userId, subtotal, discount, couponCode, shippingAddress }: NewOrder
): Promise<{ id: string; order_number: string }> => {
  for (let attempt = 1; ; attempt++) {
    await client.query("SAVEPOINT order_number");
    try {
      const { rows: [order] } = await client.query<{ id: string; order_number: string }>(
        `INSERT INTO orders (user_id, subtotal_amount, discount_amount, total_amount, coupon_code, shipping_address, order_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, order_number`,
        [userId, subtotal, discount, subtotal - discount, couponCode, shippingAddress, orderNumbers.next()]
      );
      await client.query("RELEASE SAVEPOINT order_number");
      if (!order) {
        throw new Error("Expected the new order row");
      }
      return order;
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT order_number");
      const numberTaken = isDatabaseError(err) && err.code === PG_UNIQUE_VIOLATION && err.constraint === "orders_order_number_key";
      if (!numberTaken || attempt >= 5) {
        throw err;
      }
      logger.warn({ attempt }, "Order number already taken, trying another");
    }
  }
};

const getDefaultAddress = async (client: PoolClient, userId: string): Promise<Address | undefined> => {
  const { rows: [found] } = await client.query<{ id: string }>(
    "SELECT id FROM addresses WHERE user_id = $1 AND is_default",
    [userId]
  );
  return found && getAddress(userId, found.id, client);
};

// Finds the address to ship to: the one the user picked, or else their default.
// Always filtered by userId, so nobody can ship to (and read) someone else's address.
const findShippingAddress = async (client: PoolClient, userId: string, addressId: string | undefined): Promise<ShippingAddress> => {
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

type CartLineForCheckout = {
  product_id: string;
  variant_id: string;
  quantity: number;
  name: string;
  price: number;
  stock: number;
  options: VariantOptions;
  sku: string | null;
};

// Turns the user's cart into an order. All steps run in ONE transaction:
// if anything fails (e.g. not enough stock), nothing is saved and the cart stays as it was.
export const checkout = async (userId: string, { addressId, couponCode }: Checkout = {}): Promise<Order | undefined> => {

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
    const { rows: cart } = await client.query<CartLineForCheckout>(
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
    const problems: FieldError[] = cart
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

    // 3. The money, calculated here from database prices (never from what the browser says)
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    // 4. A coupon? Lock it and check its rules now, inside this transaction.
    //    Locked after the products, like everywhere else, so locks are always taken in one order.
    const coupon = couponCode ? await reserveCoupon(client, userId, couponCode, subtotal) : null;

    const order = await insertOrderWithNumber(client, {
      userId,
      subtotal,
      discount: coupon?.discount ?? 0,
      couponCode: coupon?.code ?? null,
      shippingAddress
    });

    if (coupon) {
      await recordRedemption(client, coupon, { orderId: order.id, userId });
    }

    // The stock taken below is logged in the ledger as "order_placed" for this order
    await setStockContext(client, { reason: "order_placed", orderId: order.id, userId });

    // Queued inside the transaction: if anything below fails, there's no "order placed" email
    await enqueue("order-email", { orderId: order.id, type: "placed" }, { client });

    for (const item of cart) {
      // 5. Copy the product's name, the chosen options, SKU and price into the order (the snapshot)
      await client.query(
        `INSERT INTO order_items
           (order_id, product_id, variant_id, product_name, variant_options, sku, unit_price, quantity, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [order.id, item.product_id, item.variant_id, item.name, item.options, item.sku,
          item.price, item.quantity, item.price * item.quantity]
      );

      // 6. Take the items out of stock (the trigger updates the product's total)
      await client.query(
        "UPDATE product_variants SET stock = stock - $1 WHERE id = $2",
        [item.quantity, item.variant_id]
      );
    }

    // 7. Empty the cart
    await client.query("DELETE FROM cart_items WHERE user_id = $1", [userId]);

    return order.id;
  });

  return getOrderById(orderId, { userId });
};

// ---------- Changing an order's status ----------

// Reads the order and LOCKS it until the transaction ends, so two status changes
// on the same order (e.g. a double-clicked "Cancel") run one after the other.
// userId?: customers pass theirs (only their own order); admins leave it out (any order).
const lockOrder = async (
  client: PoolClient,
  orderId: string,
  userId?: string
): Promise<{ id: string; status: OrderStatus } | undefined> => {
  const values: string[] = [orderId];
  let ownerFilter = "";

  if (userId !== undefined) {
    values.push(userId);
    ownerFilter = "AND user_id = $2";
  }

  const { rows } = await client.query<{ id: string; status: OrderStatus }>(
    `SELECT id, status FROM orders WHERE id = $1 ${ownerFilter} FOR UPDATE`,
    values
  );
  return rows[0];
};

// Puts a cancelled order's items back in stock
const restoreStock = async (client: PoolClient, orderId: string): Promise<void> => {
  // Lock the products and variants first, in the same order checkout uses (prevents deadlocks)
  const { rows: lines } = await client.query<{ variant_id: string; quantity: number }>(
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
  await setStockContext(client, { reason: "order_cancelled", orderId });
  for (const line of lines) {
    await client.query(
      "UPDATE product_variants SET stock = stock + $1 WHERE id = $2",
      [line.quantity, line.variant_id]
    );
  }
};

// cancelReason: who/what cancelled it (only stored when the new status is "cancelled").
// Exclude<OrderStatus, "pending">: every status an order can MOVE TO. Each one sends the
// customer an email of the same name, and there's no "pending" email (orders start pending).
const applyStatus = async (
  client: TransactionClient,
  orderId: string,
  newStatus: Exclude<OrderStatus, "pending">,
  { cancelReason = null }: { cancelReason?: CancelReason | null } = {}
): Promise<void> => {
  if (newStatus === "cancelled") {
    await restoreStock(client, orderId);
    // Give the coupon use back (after the stock: products first, then coupons, as at checkout)
    await releaseCoupon(client, orderId);
  }

  await client.query(
    "UPDATE orders SET status = $1, cancel_reason = $3, updated_at = NOW() WHERE id = $2",
    [newStatus, orderId, newStatus === "cancelled" ? cancelReason : null]
  );

  // Part of this transaction: sent only if the change is saved
  await enqueue("order-email", { orderId, type: newStatus }, { client });
};

// A customer cancelling their own order: only while it's still pending
export const cancelOrder = async (userId: string, orderId: string): Promise<Order | undefined> => {

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
export const changeOrderStatus = async (orderId: string, newStatus: OrderStatus): Promise<Order | undefined> => {

  const refundId = await withTransaction(async (client) => {

    const order = await lockOrder(client, orderId);

    if (!order) {
      throw new AppError(404, "Order not found");
    }
    // No order ever moves back to "pending" (canChangeStatus says so too); checking it here
    // also tells TypeScript that newStatus is one applyStatus accepts
    if (newStatus === "pending" || !canChangeStatus(order.status, newStatus)) {
      throw new AppError(409, `Can't change an order from "${order.status}" to "${newStatus}"`);
    }

    await applyStatus(client, orderId, newStatus, { cancelReason: "admin" });

    // Cancelling an order the customer already paid for: give the money back.
    // (Orders marked "paid" by hand, e.g. cash, have no online payment and get no refund.)
    if (order.status === "paid" && newStatus === "cancelled") {
      const { rows: [payment] } = await client.query<{ id: string }>(
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
export const expireUnpaidOrders = async ({ maxOrders = 100 }: { maxOrders?: number } = {}): Promise<string[]> => {

  const expired: string[] = [];

  while (expired.length < maxOrders) {
    const orderId = await withTransaction(async (client) => {
      const { rows: [order] } = await client.query<{ id: string }>(
        `SELECT id FROM orders
         WHERE status = 'pending'
           AND created_at < NOW() - make_interval(mins => $1)
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [env.ORDER_PAYMENT_TIMEOUT_MINUTES]
      );

      if (!order) {
        return null;
      }

      await applyStatus(client, order.id, "cancelled", { cancelReason: "payment_timeout" });
      return order.id;
    });

    if (!orderId) {
      break;
    }

    logger.info({ orderId }, "Cancelled unpaid order: payment time ran out, stock released");
    expired.push(orderId);
  }

  return expired;
};
