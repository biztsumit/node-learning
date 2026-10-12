import { z } from "zod";
import { dbIdSchema, MAX_DB_INTEGER } from "./common.validators.js";

export const productSchema = z.object({
  name: z
    .string({ error: "name is required" })
    .trim()
    .min(1, { error: "name is required" })
    .max(255, { error: "name must be at most 255 characters" }),
  description: z
    .string({ error: "description must be text" })
    .trim()
    .max(5000, { error: "description must be at most 5000 characters" })
    .default(""),
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
    .default(0),
  // Only http/https links: blocks things like "javascript:..." being stored and shown in a page
  imageUrl: z
    .url({ protocol: /^https?$/, error: "imageUrl must be a valid http(s) URL" })
    .max(2000, { error: "imageUrl is too long" })
    .nullable()
    .default(null),
  // Optional: leave it out (or send null) for a product with no category
  categoryId: dbIdSchema("categoryId").nullable().default(null)
});
