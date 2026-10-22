import { z } from "zod";
import { MAX_DB_INTEGER, paginationFields } from "./common.validators.ts";

// "welcome10 " → "WELCOME10". Letters, digits, - and _ only, so codes are easy to type and read out.
const codeSchema = (label: string) => z
  .string({ error: `${label} is required` })
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z0-9_-]{3,30}$/, { error: "A coupon code is 3-30 letters, digits, - or _" }));

export const couponCodeSchema = codeSchema("couponCode");

const amount = (label: string, { min = 0 }: { min?: number } = {}) => z
  .number({ error: `${label} must be a number` })
  .int({ error: `${label} must be a whole number` })
  .min(min, { error: `${label} must be at least ${min}` })
  .max(MAX_DB_INTEGER, { error: `${label} is too large` });

// A date and time with its time zone: "2026-12-31T23:59:59+05:30" or "...Z"
const dateTime = (label: string) => z
  .iso.datetime({ offset: true, error: `${label} must be a date-time like 2026-12-31T23:59:59+05:30` })
  .transform((value) => new Date(value));

// The rules that combine several fields (percent at most 100, starts before expires...)
// are checked in the service, on the coupon as it will be after the change
const fields = {
  code: codeSchema("code"),
  description: z.string().trim().max(255, { error: "description must be at most 255 characters" }),
  discountType: z.enum(["percent", "fixed"], { error: "discountType must be percent or fixed" }),
  // percent: 1-100; fixed: rupees off
  discountValue: amount("discountValue", { min: 1 }),
  minOrderAmount: amount("minOrderAmount"),
  maxDiscount: amount("maxDiscount", { min: 1 }).nullable(),
  startsAt: dateTime("startsAt").nullable(),
  expiresAt: dateTime("expiresAt").nullable(),
  usageLimit: amount("usageLimit", { min: 1 }).nullable(),
  perUserLimit: amount("perUserLimit", { min: 1 }).nullable(),
  isActive: z.boolean({ error: "isActive must be true or false" })
};

// POST /admin/coupons: anything left out gets a sensible default
export const createCouponSchema = z.object({
  ...fields,
  description: fields.description.default(""),
  minOrderAmount: fields.minOrderAmount.default(0),
  maxDiscount: fields.maxDiscount.default(null),
  startsAt: fields.startsAt.default(null),
  expiresAt: fields.expiresAt.default(null),
  usageLimit: fields.usageLimit.default(null),
  // One use per customer unless told otherwise (null = unlimited)
  perUserLimit: fields.perUserLimit.default(1),
  isActive: fields.isActive.default(true)
});

// PATCH /admin/coupons/:id: send only what changes
export const updateCouponSchema = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { error: "Send at least one field to change" });

export const couponListQuerySchema = z.object({ ...paginationFields });

// GET /cart?coupon=WELCOME10: preview what a coupon would save
export const cartQuerySchema = z.object({
  coupon: couponCodeSchema.optional()
});

// The TypeScript types of the CHECKED data (after trimming, defaults, coercion...).
// Services use these, so the shape is written once: in the schema.
export type CouponCode = z.infer<typeof couponCodeSchema>;
export type CreateCoupon = z.infer<typeof createCouponSchema>;
export type UpdateCoupon = z.infer<typeof updateCouponSchema>;
export type CouponListQuery = z.infer<typeof couponListQuerySchema>;
export type CartQuery = z.infer<typeof cartQuerySchema>;
