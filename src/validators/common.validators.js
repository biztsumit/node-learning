import { z } from "zod";

// PostgreSQL INTEGER / SERIAL columns can't hold anything bigger than this
const MAX_DB_INTEGER = 2147483647;

// For routes like /products/:id — turns "5" into 5
export const idParamSchema = z.object({
  id: z.coerce
    .number({ error: "id must be a number" })
    .int({ error: "id must be a whole number" })
    .min(1, { error: "id must be a positive number" })
    .max(MAX_DB_INTEGER, { error: "id is too large" })
});
