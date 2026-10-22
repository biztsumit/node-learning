// Discount codes: the admin side (create, change, switch off) and the rules for using one.
import type { Pool, PoolClient, QueryResult } from "pg";
import pool from "../config/db.ts";
import { queryWithContext, withTransaction } from "../db/transaction.ts";
import { AppError } from "../utils/app-error.ts";
import { PG_RESTRICT_VIOLATION, PG_UNIQUE_VIOLATION, isDatabaseError } from "../utils/db-errors.ts";
import type { CouponListQuery, CreateCoupon, UpdateCoupon } from "../validators/coupon.validators.ts";

const COLUMNS = `id, code, description, discount_type, discount_value, min_order_amount, max_discount,
  starts_at, expires_at, usage_limit, per_user_limit, times_used, is_active, created_at, updated_at`;

type DiscountType = "percent" | "fixed";

type CouponRow = {
  id: string;
  code: string;
  description: string;
  discount_type: DiscountType;
  discount_value: number;
  min_order_amount: number;
  max_discount: number | null;
  starts_at: Date | null;
  expires_at: Date | null;
  usage_limit: number | null;
  per_user_limit: number | null;
  times_used: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type Coupon = {
  id: string;
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  minOrderAmount: number;
  maxDiscount: number | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  timesUsed: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const toCoupon = (row: CouponRow): Coupon => ({
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

const rupees = (amount: number): string => `₹${amount.toLocaleString("en-IN")}`;

// ---------- The maths ----------

// How many rupees a coupon takes off a cart worth `subtotal`.
// Whole rupees, rounded DOWN (the shop never gives away a fraction more than promised),
// and never so much that less than ₹1 is left: ₹1 is the smallest payment Razorpay takes.
// Pick<...>: only needs these three fields, so the tests can pass just those.
export const calculateDiscount = (
  coupon: Pick<CouponRow, "discount_type" | "discount_value" | "max_discount">,
  subtotal: number
): number => {
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
const cantUse = (message: string) => new AppError(409, message, [{ field: "couponCode", message }]);

// Checks every rule for this customer and cart (or throws why not). Returns the coupon it
// checked together with the discount: from then on TypeScript knows the coupon exists.
// `db` is a transaction client at checkout (with the coupon row locked) or the pool for a preview.
const checkCoupon = async (
  db: Pool | PoolClient,
  coupon: CouponRow | undefined,
  userId: string,
  subtotal: number
): Promise<{ coupon: CouponRow; discount: number }> => {
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
    const { rows } = await db.query<{ used: number }>(
      `SELECT COUNT(*)::int AS used FROM coupon_redemptions
       WHERE coupon_id = $1 AND user_id = $2 AND released_at IS NULL`,
      [coupon.id, userId]
    );
    const used = rows[0]?.used ?? 0;
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
  return { coupon, discount };
};

export type CouponPreview = { code: string; description: string; discount: number };

// GET /cart?coupon=CODE: what the coupon would save right now (nothing is reserved)
export const previewCoupon = async (userId: string, code: string, subtotal: number): Promise<CouponPreview> => {
  const { rows } = await pool.query<CouponRow>(`SELECT ${COLUMNS} FROM coupons WHERE code = $1`, [code]);
  const { coupon, discount } = await checkCoupon(pool, rows[0], userId, subtotal);
  return { code: coupon.code, description: coupon.description, discount };
};

// What checkout holds on to between "reserve" and "record"
export type CouponReservation = { couponId: string; code: string; discount: number };

// Checkout, step 1 (inside its transaction): LOCK the coupon row, then check the rules.
// Two customers taking the last use of a coupon at the same moment queue up here:
// the second one only reads times_used after the first has committed (or rolled back),
// so a "100 uses" coupon can never be used 101 times.
export const reserveCoupon = async (client: PoolClient, userId: string, code: string, subtotal: number): Promise<CouponReservation> => {
  const { rows } = await client.query<CouponRow>(`SELECT ${COLUMNS} FROM coupons WHERE code = $1 FOR UPDATE`, [code]);
  const { coupon, discount } = await checkCoupon(client, rows[0], userId, subtotal);
  return { couponId: coupon.id, code: coupon.code, discount };
};

// Checkout, step 2 (same transaction, once the order exists): record the use
export const recordRedemption = async (
  client: PoolClient,
  reservation: CouponReservation,
  { orderId, userId }: { orderId: string; userId: string }
): Promise<void> => {
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
export const releaseCoupon = async (client: PoolClient, orderId: string): Promise<void> => {
  const { rows: [released] } = await client.query<{ coupon_id: string }>(
    `UPDATE coupon_redemptions SET released_at = NOW()
     WHERE order_id = $1 AND released_at IS NULL
     RETURNING coupon_id`,
    [orderId]
  );
  if (released) {
    await client.query("UPDATE coupons SET times_used = times_used - 1 WHERE id = $1", [released.coupon_id]);
  }
};

// ---------- Admins ----------

export const listCoupons = async ({ page, limit }: CouponListQuery) => {
  const [rowsResult, countResult] = await Promise.all([
    pool.query<CouponRow>(
      `SELECT ${COLUMNS} FROM coupons ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit]
    ),
    pool.query<{ total: number }>("SELECT COUNT(*)::int AS total FROM coupons")
  ]);
  const total = countResult.rows[0]?.total ?? 0;
  return {
    coupons: rowsResult.rows.map(toCoupon),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  };
};

export const getCoupon = async (id: string): Promise<Coupon | undefined> => {
  const { rows } = await pool.query<CouponRow>(`SELECT ${COLUMNS} FROM coupons WHERE id = $1`, [id]);
  return rows[0] && toCoupon(rows[0]);
};

// The fields the multi-field rules look at
type RuleFields = Pick<Coupon, "discountType" | "discountValue" | "maxDiscount" | "startsAt" | "expiresAt" | "usageLimit" | "timesUsed">;

// The rules that involve more than one field. Checked on the coupon as it WOULD be after
// the change (current values + changes), so a PATCH of one field can't break the others.
const checkRules = (c: RuleFields): void => {
  if (c.discountType === "percent" && c.discountValue > 100) {
    throw new AppError(400, "Validation failed", [{ field: "discountValue", message: "A percent discount can be at most 100" }]);
  }
  if (c.discountType === "fixed" && c.maxDiscount !== null) {
    throw new AppError(400, "Validation failed", [{ field: "maxDiscount", message: "maxDiscount is only for percent coupons" }]);
  }
  if (c.startsAt && c.expiresAt && c.startsAt >= c.expiresAt) {
    throw new AppError(400, "Validation failed", [{ field: "expiresAt", message: "expiresAt must be after startsAt" }]);
  }
  if (c.usageLimit !== null && c.usageLimit < c.timesUsed) {
    throw new AppError(409, `This coupon has already been used ${c.timesUsed} times: usageLimit can't be lower`);
  }
};

// Runs the INSERT/UPDATE and turns "that code is taken" into a clear 409
const save = async (run: () => Promise<QueryResult<CouponRow>>): Promise<Coupon> => {
  try {
    const { rows: [row] } = await run();
    if (!row) {
      throw new AppError(404, "Coupon not found");
    }
    return toCoupon(row);
  } catch (err) {
    if (isDatabaseError(err) && err.code === PG_UNIQUE_VIOLATION && err.constraint === "coupons_code_key") {
      throw new AppError(409, "A coupon with this code already exists");
    }
    throw err;
  }
};

// API field → column. "satisfies" checks each field name is a real coupon field.
const FIELDS = [
  ["code", "code"], ["description", "description"], ["discountType", "discount_type"],
  ["discountValue", "discount_value"], ["minOrderAmount", "min_order_amount"], ["maxDiscount", "max_discount"],
  ["startsAt", "starts_at"], ["expiresAt", "expires_at"], ["usageLimit", "usage_limit"],
  ["perUserLimit", "per_user_limit"], ["isActive", "is_active"]
] as const satisfies ReadonlyArray<readonly [keyof CreateCoupon, string]>;

export const createCoupon = async (data: CreateCoupon): Promise<Coupon> => {
  checkRules({ ...data, timesUsed: 0 });
  return save(() => queryWithContext<CouponRow>(
    `INSERT INTO coupons (${FIELDS.map(([, column]) => column).join(", ")})
     VALUES (${FIELDS.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING ${COLUMNS}`,
    FIELDS.map(([field]) => data[field])
  ));
};

// Partial update: only the fields sent change. Sending null clears an optional limit.
export const updateCoupon = (id: string, changes: UpdateCoupon): Promise<Coupon> =>
  withTransaction(async (client) => {
    const { rows: [current] } = await client.query<CouponRow>(`SELECT ${COLUMNS} FROM coupons WHERE id = $1 FOR UPDATE`, [id]);
    if (!current) {
      throw new AppError(404, "Coupon not found");
    }
    checkRules({ ...toCoupon(current), ...changes });

    const sent = FIELDS.filter(([field]) => changes[field] !== undefined);
    return save(() => client.query<CouponRow>(
      `UPDATE coupons
       SET ${sent.map(([, column], i) => `${column} = $${i + 2}`).join(", ")}, updated_at = NOW()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id, ...sent.map(([field]) => changes[field])]
    ));
  });

// Only a coupon nobody has used can be deleted; otherwise its history would point at nothing.
// No "count first, then delete": a checkout could use it in between. The foreign key
// (ON DELETE RESTRICT) makes the database refuse, at the exact moment of the delete.
export const deleteCoupon = async (id: string): Promise<void> => {
  try {
    const { rowCount } = await queryWithContext("DELETE FROM coupons WHERE id = $1", [id]);
    if (!rowCount) {
      throw new AppError(404, "Coupon not found");
    }
  } catch (err) {
    if (isDatabaseError(err) && err.code === PG_RESTRICT_VIOLATION) {
      throw new AppError(409, "This coupon has been used, so it can't be deleted. Set isActive to false instead");
    }
    throw err;
  }
};
