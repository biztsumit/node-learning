import { z } from "zod";
import { idSchema } from "./common.validators.js";

// Most of one product a single cart can hold
export const MAX_QUANTITY_PER_ITEM = 99;

const quantitySchema = z
  .number({ error: "quantity must be a number" })
  .int({ error: "quantity must be a whole number" })
  .min(1, { error: "quantity must be at least 1" })
  .max(MAX_QUANTITY_PER_ITEM, { error: `quantity must be at most ${MAX_QUANTITY_PER_ITEM}` });

// POST /cart/items
export const addCartItemSchema = z.object({
  productId: idSchema("productId"),
  quantity: quantitySchema.default(1)
});

// PATCH /cart/items/:productId
export const updateCartItemSchema = z.object({
  quantity: quantitySchema
});

// For routes like /cart/items/:productId
export const productIdParamSchema = z.object({
  productId: idSchema("productId")
});
