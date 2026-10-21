import { z } from "zod";

// PostgreSQL INTEGER columns (prices, stock, ...) can't hold anything bigger than this
export const MAX_DB_INTEGER = 2147483647;

// A database id: a UUID like "01a14386-1238-7b41-9618-7ff4c0a7b55d".
// Checking the format here means a bad id gets a clear 400, instead of a database error (500).
export const idSchema = (label) => z
  .string({ error: `${label} is required` })
  .trim()
  .toLowerCase()
  .pipe(z.uuid({ error: `${label} must be a valid id` }));

// For routes like /products/:id
export const idParamSchema = z.object({
  id: idSchema("id")
});

// For routes like /products/slug/:slug
export const slugParamSchema = z.object({
  slug: z
    .string()
    .max(255, { error: "slug is too long" })
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { error: "slug can only contain a-z, 0-9 and single dashes" })
});

// ?page=2&limit=20 — spread into any list query schema: z.object({ ...paginationFields, ... })
export const paginationFields = {
  page: z.coerce
    .number({ error: "page must be a number" })
    .int({ error: "page must be a whole number" })
    .min(1, { error: "page must be at least 1" })
    .max(10000, { error: "page is too large" })
    .default(1),
  limit: z.coerce
    .number({ error: "limit must be a number" })
    .int({ error: "limit must be a whole number" })
    .min(1, { error: "limit must be at least 1" })
    .max(100, { error: "limit must be at most 100" })
    .default(20)
};

// For long lists that also support cursor pagination: ?cursor=<nextCursor from the last page>.
// page has no default here, so we can tell "page wasn't sent" (the service uses 1).
export const cursorPaginationFields = {
  page: paginationFields.page.unwrap().optional(),
  limit: paginationFields.limit,
  cursor: z.string().max(1000, { error: "cursor is too long" }).optional()
};

// Add to a list schema using cursorPaginationFields: page numbers and cursors don't mix
export const pageOrCursor = [
  (query) => query.page === undefined || query.cursor === undefined,
  { error: "Use either page or cursor, not both", path: ["cursor"] }
];
