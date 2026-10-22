// Discount codes: the admin side (create, change, switch off) and the rules for using one.
import pool from "../config/db.js";
import { queryWithContext, withTransaction } from "../db/transaction.js";
import { AppError } from "../utils/app-error.js";
import { PG_RESTRICT_VIOLATION, PG_UNIQUE_VIOLATION } from "../utils/db-errors.js";

const COLUMNS = `id, code, description, discount_type, discount_value, min_order_amount, max_discount,
  starts_at, expires_at, usage_limit, per_user_limit, times_used, is_active, created_at, updated_at`;

const toCoupon = (row) => ({
  id: row.id,
  code: row.code,
  description: row.description,
  discountType: row.discount_type,
  discountValue: row.discount_value,
  minOrderAmount: row.min_order_amount,
  maxDiscount: row.max_discount,
  startsAt: row.starts_at,
  expiresAt: row.expires_at,
  usageLimit: row.usage_limit,
  perUserLimit: row.per_user_limit,
  timesUsed: row.times_used,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const rupees = (amount) => `₹${amount.toLocaleString("en-IN")}`;

// ---------- The maths ----------

// How many rupees a coupon takes off a cart worth `subtotal`.
// Whole rupees, rounded DOWN (the shop never gives away a fraction more than promised),
// and never so much that less than ₹1 is left: ₹1 is the smallest payment Razorpay takes.
export const calculateDiscount = (coupon, subtotal) => {
  let discount = coupon.discount_type === "percent"
    ? Math.floor((subtotal * coupon.discount_value) / 100)
    : coupon.discount_value;

  if (coupon.max_discount !== null) {
    discount = Math.min(discount, coupon.max_discount);
  }
  return Math.max(0, Math.min(discount, subtotal - 1));
};

// ---------- Using a coupon ----------

// The reason a coupon can't be used, as an error the customer can understand
const cantUse = (message) => new AppError(409, message, [{ field: "couponCode", message }]);

// Checks every rule for this customer and cart, and returns the discount (or throws why not).
// `db` is a transaction client at checkout (with the coupon row locked) or the pool for a preview.
const checkCoupon = async (db, coupon, userId, subtotal) => {
  const now = new Date();

  if (!coupon || !coupon.is_active) {
    throw new AppError(404, "Coupon not found", [{ field: "couponCode", message: "There's no such coupon" }]);
  }
  if (coupon.starts_at && now < coupon.starts_at) {
    throw cantUse("This coupon isn't active yet");
  }
  if (coupon.expires_at && now >= coupon.expires_at) {
    throw cantUse("This coupon has expired");
  }
  if (coupon.usage_limit !== null && coupon.times_used >= coupon.usage_limit) {
    throw cantUse("This coupon has been fully used");
  }
  if (coupon.per_user_limit !== null) {
    const { rows: [{ used }] } = await db.query(
      `SELECT COUNT(*)::int AS used FROM coupon_redemptions
       WHERE coupon_id = $1 AND user_id = $2 AND released_at IS NULL`,
      [coupon.id, userId]
    );
    if (used >= coupon.per_user_limit) {
      throw cantUse(coupon.per_user_limit === 1
        ? "You've already used this coupon"
        : `You've already used this coupon ${used} times (the limit)`);
    }
  }
  if (subtotal < coupon.min_order_amount) {
    throw cantUse(`Add ${rupees(coupon.min_order_amount - subtotal)} more to use this coupon (minimum order ${rupees(coupon.min_order_amount)})`);
  }

  const discount = calculateDiscount(coupon, subtotal);
  if (discount === 0) {
    throw cantUse("This coupon gives no discount on this cart");
  }
  return discount;
};

// GET /cart?coupon=CODE: what the coupon would save right now (nothing is reserved)
export const previewCoupon = async (userId, code, subtotal) => {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM coupons WHERE code = $1`, [code]);
  const discount = await checkCoupon(pool, rows[0], userId, subtotal);
  return { code: rows[0].code, description: rows[0].description, discount };
};

// Checkout, step 1 (inside its transaction): LOCK the coupon row, then check the rules.
// Two customers taking the last use of a coupon at the same moment queue up here:
// the second one only reads times_used after the first has committed (or rolled back),
// so a "100 uses" coupon can never be used 101 times.
export const reserveCoupon = async (client, userId, code, subtotal) => {
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM coupons WHERE code = $1 FOR UPDATE`, [code]);
  const discount = await checkCoupon(client, rows[0], userId, subtotal);
  return { couponId: rows[0].id, code: rows[0].code, discount };
};

// Checkout, step 2 (same transaction, once the order exists): record the use
export const recordRedemption = async (client, reservation, { orderId, userId }) => {
  await client.query(
    `INSERT INTO coupon_redemptions (coupon_id, order_id, user_id, discount_amount)
     VALUES ($1, $2, $3, $4)`,
    [reservation.couponId, orderId, userId, reservation.discount]
  );
  await client.query(
    "UPDATE coupons SET times_used = times_used + 1 WHERE id = $1",
    [reservation.couponId]
  );
};

// An order was cancelled: its coupon use is given back, so the customer can use it again.
// (The order itself keeps its discount and coupon code: that's what happened.)
export const releaseCoupon = async (client, orderId) => {
  const { rows } = await client.query(
    `UPDATE coupon_redemptions SET released_at = NOW()
     WHERE order_id = $1 AND released_at IS NULL
     RETURNING coupon_id`,
    [orderId]
  );
  if (rows.length > 0) {
    await client.query("UPDATE coupons SET times_used = times_used - 1 WHERE id = $1", [rows[0].coupon_id]);
  }
};

// ---------- Admins ----------

export const listCoupons = async ({ page, limit }) => {
  const [rowsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT ${COLUMNS} FROM coupons ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit]
    ),
    pool.query("SELECT COUNT(*)::int AS total FROM coupons")
  ]);
  const total = countResult.rows[0].total;
  return {
    coupons: rowsResult.rows.map(toCoupon),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  };
};

export const getCoupon = async (id) => {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM coupons WHERE id = $1`, [id]);
  return rows[0] && toCoupon(rows[0]);
};

// The rules that involve more than one field. Checked on the coupon as it WOULD be after
// the change (current values + changes), so a PATCH of one field can't break the others.
const checkRules = (c) => {
  if (c.discountType === "percent" && c.discountValue > 100) {
    throw new AppError(400, "Validation failed", [{ field: "discountValue", message: "A percent discount can be at most 100" }]);
  }
  if (c.discountType === "fixed" && c.maxDiscount !== null) {
    throw new AppError(400, "Validation failed", [{ field: "maxDiscount", message: "maxDiscount is only for percent coupons" }]);
  }
  if (c.startsAt && c.expiresAt && new Date(c.startsAt) >= new Date(c.expiresAt)) {
    throw new AppError(400, "Validation failed", [{ field: "expiresAt", message: "expiresAt must be after startsAt" }]);
  }
  if (c.usageLimit !== null && c.usageLimit < c.timesUsed) {
    throw new AppError(409, `This coupon has already been used ${c.timesUsed} times: usageLimit can't be lower`);
  }
};

const save = async (db, sql, values) => {
  try {
    const { rows } = await db.query(sql, values);
    return toCoupon(rows[0]);
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION && err.constraint === "coupons_code_key") {
      throw new AppError(409, "A coupon with this code already exists");
    }
    throw err;
  }
};

const FIELDS = [
  ["code", "code"], ["description", "description"], ["discountType", "discount_type"],
  ["discountValue", "discount_value"], ["minOrderAmount", "min_order_amount"], ["maxDiscount", "max_discount"],
  ["startsAt", "starts_at"], ["expiresAt", "expires_at"], ["usageLimit", "usage_limit"],
  ["perUserLimit", "per_user_limit"], ["isActive", "is_active"]
];

export const createCoupon = async (data) => {
  checkRules({ ...data, timesUsed: 0 });
  return save(
    { query: queryWithContext },
    `INSERT INTO coupons (${FIELDS.map(([, column]) => column).join(", ")})
     VALUES (${FIELDS.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING ${COLUMNS}`,
    FIELDS.map(([field]) => data[field])
  );
};

// Partial update: only the fields sent change. Sending null clears an optional limit.
export const updateCoupon = (id, changes) =>
  withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT ${COLUMNS} FROM coupons WHERE id = $1 FOR UPDATE`, [id]);
    if (rows.length === 0) {
      throw new AppError(404, "Coupon not found");
    }
    checkRules({ ...toCoupon(rows[0]), ...changes });

    const sent = FIELDS.filter(([field]) => changes[field] !== undefined);
    return save(
      client,
      `UPDATE coupons
       SET ${sent.map(([, column], i) => `${column} = $${i + 2}`).join(", ")}, updated_at = NOW()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id, ...sent.map(([field]) => changes[field])]
    );
  });

// Only a coupon nobody has used can be deleted; otherwise its history would point at nothing.
// No "count first, then delete": a checkout could use it in between. The foreign key
// (ON DELETE RESTRICT) makes the database refuse, at the exact moment of the delete.
export const deleteCoupon = async (id) => {
  try {
    const { rowCount } = await queryWithContext("DELETE FROM coupons WHERE id = $1", [id]);
    if (rowCount === 0) {
      throw new AppError(404, "Coupon not found");
    }
  } catch (err) {
    if (err.code === PG_RESTRICT_VIOLATION) {
      throw new AppError(409, "This coupon has been used, so it can't be deleted. Set isActive to false instead");
    }
    throw err;
  }
};
