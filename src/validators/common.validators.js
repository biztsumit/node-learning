import { z } from "zod";

// PostgreSQL INTEGER / SERIAL columns can't hold anything bigger than this
const MAX_DB_INTEGER = 2147483647;

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
