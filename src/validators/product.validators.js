import { z } from "zod";
import { idSchema, MAX_DB_INTEGER, cursorPaginationFields, pageOrCursor } from "./common.validators.js";

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
  categoryId: idSchema("categoryId").nullable().default(null)
});

// PUT /products/:id — like creating, but price and stock are optional: they belong to the
// product's variant, so they're only accepted for a product with exactly one variant
export const productUpdateSchema = productSchema.extend({
  price: productSchema.shape.price.optional(),
  stock: productSchema.shape.stock.unwrap().optional()
});

// Query string of GET /products, e.g. ?search=shirt&category=<uuid>&sort=price_asc&page=2
// Everything in a query string is text, so numbers use z.coerce.
const optionalPrice = (label) => z.coerce
  .number({ error: `${label} must be a number` })
  .int({ error: `${label} must be a whole number` })
  .min(0, { error: `${label} can't be negative` })
  .max(MAX_DB_INTEGER, { error: `${label} is too large` })
  .optional();

export const productListQuerySchema = z
  .object({
    search: z.string().trim().max(100, { error: "search must be at most 100 characters" }).optional(),
    category: idSchema("category").optional(),
    minPrice: optionalPrice("minPrice"),
    maxPrice: optionalPrice("maxPrice"),
    // Not z.coerce.boolean(): that turns the text "false" into true!
    inStock: z
      .enum(["true", "false"], { error: "inStock must be true or false" })
      .transform((value) => value === "true")
      .optional(),
    sort: z
      .enum(["relevance", "newest", "price_asc", "price_desc", "name_asc", "rating_desc"], {
        error: "sort must be one of: relevance, newest, price_asc, price_desc, name_asc, rating_desc"
      })
      // Left out: "relevance" when searching, "newest" otherwise
      .optional(),
    ...cursorPaginationFields
  })
  .refine(...pageOrCursor)
  .refine(
    (query) => query.minPrice === undefined || query.maxPrice === undefined || query.minPrice <= query.maxPrice,
    { error: "minPrice can't be greater than maxPrice", path: ["minPrice"] }
  );
