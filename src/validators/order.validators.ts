import { z } from "zod";
import { idSchema, cursorPaginationFields, pageOrCursor } from "./common.validators.ts";
import { ORDER_STATUSES } from "../utils/order-status.ts";
import { ORDER_NUMBER_PATTERN } from "../utils/order-number.ts";
import { couponCodeSchema } from "./coupon.validators.ts";

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

// GET /orders?status=pending&page=1  (or &cursor=<nextCursor>)
const orderListFields = {
  status: statusSchema.optional(),
  ...cursorPaginationFields
};
export const orderListQuerySchema = z.object(orderListFields).refine(...pageOrCursor);

// GET /admin/orders?userId=<uuid>&status=paid
export const adminOrderListQuerySchema = z.object({
  ...orderListFields,
  userId: idSchema("userId").optional(),
  // A customer quoting their order number on the phone
  orderNumber: orderNumberSchema.optional()
}).refine(...pageOrCursor);

// PATCH /admin/orders/:id/status
export const updateOrderStatusSchema = z.object({
  status: statusSchema
});

// The TypeScript types of the CHECKED data (after trimming, defaults, coercion...).
// Services use these, so the shape is written once: in the schema.
export type OrderNumberParam = z.infer<typeof orderNumberParamSchema>;
export type Checkout = z.infer<typeof checkoutSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;
export type UpdateOrderStatus = z.infer<typeof updateOrderStatusSchema>;
