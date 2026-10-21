import { z } from "zod";
import { idSchema, paginationFields } from "./common.validators.js";

// For /wishlist/:productId
export const productIdParamSchema = z.object({
  productId: idSchema("productId")
});

// The reasons an admin can give. 'initial', 'order_placed', 'order_cancelled' and 'manual'
// are written by the app/database itself, never chosen by hand.
export const ADJUSTMENT_REASONS = ["restock", "damaged", "returned", "correction"];
export const MOVEMENT_REASONS = [...ADJUSTMENT_REASONS, "initial", "order_placed", "order_cancelled", "manual"];

// POST /admin/stock-movements  { variantId, change: 10, reason: "restock", note? }
export const stockAdjustmentSchema = z
  .object({
    variantId: idSchema("variantId"),
    change: z
      .number({ error: "change must be a number" })
      .int({ error: "change must be a whole number" })
      .min(-100000, { error: "change is too large" })
      .max(100000, { error: "change is too large" })
      .refine((value) => value !== 0, { error: "change can't be 0" }),
    reason: z.enum(ADJUSTMENT_REASONS, { error: `reason must be one of: ${ADJUSTMENT_REASONS.join(", ")}` }),
    note: z.string().trim().max(255, { error: "note must be at most 255 characters" }).optional()
  })
  // Stock arriving is +, stock leaving is -: catches a "restock" of -10 typed by mistake
  .refine((body) => !["restock", "returned"].includes(body.reason) || body.change > 0, {
    error: "restock and returned add stock: change must be positive",
    path: ["change"]
  })
  .refine((body) => body.reason !== "damaged" || body.change < 0, {
    error: "damaged removes stock: change must be negative",
    path: ["change"]
  });

// GET /admin/stock-movements?productId=&variantId=&orderId=&reason=
export const stockMovementListQuerySchema = z.object({
  productId: idSchema("productId").optional(),
  variantId: idSchema("variantId").optional(),
  orderId: idSchema("orderId").optional(),
  reason: z.enum(MOVEMENT_REASONS, { error: `reason must be one of: ${MOVEMENT_REASONS.join(", ")}` }).optional(),
  ...paginationFields
});
