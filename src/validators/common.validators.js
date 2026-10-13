import { z } from "zod";

// PostgreSQL INTEGER / SERIAL columns can't hold anything bigger than this
export const MAX_DB_INTEGER = 2147483647;

// A valid database id, e.g. 5
export const dbIdSchema = (label) => z
  .number({ error: `${label} must be a number` })
  .int({ error: `${label} must be a whole number` })
  .min(1, { error: `${label} must be a positive number` })
  .max(MAX_DB_INTEGER, { error: `${label} is too large` });

// For routes like /products/:id — turns "5" into 5
export const idParamSchema = z.object({
  id: z.coerce.number({ error: "id must be a number" }).pipe(dbIdSchema("id"))
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
