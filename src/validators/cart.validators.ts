import { z } from "zod";
import { idSchema } from "./common.validators.ts";

// Most of one product a single cart can hold
export const MAX_QUANTITY_PER_ITEM = 99;

const quantitySchema = z
  .number({ error: "quantity must be a number" })
  .int({ error: "quantity must be a whole number" })
  .min(1, { error: "quantity must be at least 1" })
  .max(MAX_QUANTITY_PER_ITEM, { error: `quantity must be at most ${MAX_QUANTITY_PER_ITEM}` });

// POST /cart/items — variantId picks the option (size, colour...). It can be left out
// for a product that has only one variant.
export const addCartItemSchema = z.object({
  productId: idSchema("productId"),
  variantId: idSchema("variantId").optional(),
  quantity: quantitySchema.default(1)
});

// PATCH /cart/items/:id
export const updateCartItemSchema = z.object({
  quantity: quantitySchema
});

// The TypeScript types of the CHECKED data (after trimming, defaults, coercion...).
// Services use these, so the shape is written once: in the schema.
export type AddCartItem = z.infer<typeof addCartItemSchema>;
export type UpdateCartItem = z.infer<typeof updateCartItemSchema>;
