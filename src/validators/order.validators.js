import { z } from "zod";
import { dbIdSchema, paginationFields } from "./common.validators.js";
import { ORDER_STATUSES } from "../utils/order-status.js";

const statusSchema = z.enum(ORDER_STATUSES, {
  error: `status must be one of: ${ORDER_STATUSES.join(", ")}`
});

// POST /orders — leave addressId out to use your default address
export const checkoutSchema = z.object({
  addressId: dbIdSchema("addressId").optional()
});

// GET /orders?status=pending&page=1
export const orderListQuerySchema = z.object({
  status: statusSchema.optional(),
  ...paginationFields
});

// GET /admin/orders?userId=5&status=paid
export const adminOrderListQuerySchema = orderListQuerySchema.extend({
  userId: z.coerce.number({ error: "userId must be a number" }).pipe(dbIdSchema("userId")).optional()
});

// PATCH /admin/orders/:id/status
export const updateOrderStatusSchema = z.object({
  status: statusSchema
});
