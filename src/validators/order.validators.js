import { z } from "zod";
import { idSchema, paginationFields } from "./common.validators.js";
import { ORDER_STATUSES } from "../utils/order-status.js";
import { ORDER_NUMBER_PATTERN } from "../utils/order-number.js";
import { couponCodeSchema } from "./coupon.validators.js";

// "ORD-7K3M9Q". Also accepts what people actually type: "ord-7k3m9q", " 7K3M9Q "
const orderNumberSchema = z
  .string({ error: "orderNumber is required" })
  .trim()
  .toUpperCase()
  .transform((value) => (value.startsWith("ORD-") ? value : `ORD-${value}`))
  .pipe(z.string().regex(ORDER_NUMBER_PATTERN, { error: "orderNumber must look like ORD-7K3M9Q" }));

// GET /orders/number/:orderNumber
export const orderNumberParamSchema = z.object({
  orderNumber: orderNumberSchema
});

const statusSchema = z.enum(ORDER_STATUSES, {
  error: `status must be one of: ${ORDER_STATUSES.join(", ")}`
});

// POST /orders — leave addressId out to use your default address
export const checkoutSchema = z.object({
  addressId: idSchema("addressId").optional(),
  couponCode: couponCodeSchema.optional()
});

// GET /orders?status=pending&page=1
export const orderListQuerySchema = z.object({
  status: statusSchema.optional(),
  ...paginationFields
});

// GET /admin/orders?userId=<uuid>&status=paid
export const adminOrderListQuerySchema = orderListQuerySchema.extend({
  userId: idSchema("userId").optional(),
  // A customer quoting their order number on the phone
  orderNumber: orderNumberSchema.optional()
});

// PATCH /admin/orders/:id/status
export const updateOrderStatusSchema = z.object({
  status: statusSchema
});
