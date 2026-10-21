import { z } from "zod";
import { idSchema, MAX_DB_INTEGER } from "./common.validators.js";

// {"size": "M", "colour": "Blue"}: up to 3 options. Names are stored lowercase and trimmed,
// so "Size" and " size " count as the same option.
const optionsSchema = z
  .record(
    z.string().trim().min(1, { error: "option names can't be empty" }).max(30, { error: "option names must be at most 30 characters" }),
    z.string({ error: "option values must be text" }).trim().min(1, { error: "option values can't be empty" }).max(50, { error: "option values must be at most 50 characters" }),
    { error: "options must be an object like { \"size\": \"M\" }" }
  )
  .refine((options) => Object.keys(options).length <= 3, { error: "a variant can have at most 3 options" })
  .transform((options) => Object.fromEntries(Object.entries(options).map(([name, value]) => [name.toLowerCase(), value])));

const fields = {
  options: optionsSchema,
  sku: z
    .string({ error: "sku must be text" })
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,64}$/, { error: "sku can use letters, digits, . _ - (up to 64)" })
    .nullable(),
  price: z
    .number({ error: "price must be a number" })
    .int({ error: "price must be a whole number" })
    .min(0, { error: "price can't be negative" })
    .max(MAX_DB_INTEGER, { error: "price is too large" }),
  stock: z
    .number({ error: "stock must be a number" })
    .int({ error: "stock must be a whole number" })
    .min(0, { error: "stock can't be negative" })
    .max(MAX_DB_INTEGER, { error: "stock is too large" })
};

// POST /products/:id/variants
export const createVariantSchema = z.object({
  options: fields.options,
  sku: fields.sku.optional(),
  price: fields.price,
  stock: fields.stock.default(0)
});

// PATCH /products/:id/variants/:variantId
export const updateVariantSchema = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { error: "Send at least one field to update" });

// /products/:id/variants/:variantId
export const variantParamsSchema = z.object({
  id: idSchema("id"),
  variantId: idSchema("variantId")
});
