import { z } from "zod";
import { idSchema, paginationFields } from "./common.validators.js";
import { ORDER_STATUSES } from "../utils/order-status.js";

const statusSchema = z.enum(ORDER_STATUSES, {
  error: `status must be one of: ${ORDER_STATUSES.join(", ")}`
});

// POST /orders — leave addressId out to use your default address
export const checkoutSchema = z.object({
  addressId: idSchema("addressId").optional()
});

// GET /orders?status=pending&page=1
export const orderListQuerySchema = z.object({
  status: statusSchema.optional(),
  ...paginationFields
});

// GET /admin/orders?userId=<uuid>&status=paid
export const adminOrderListQuerySchema = orderListQuerySchema.extend({
  userId: idSchema("userId").optional()
});

// PATCH /admin/orders/:id/status
export const updateOrderStatusSchema = z.object({
  status: statusSchema
});
