import { z } from "zod";
import { dbIdSchema } from "./common.validators.js";

export const productSchema = z.object({
  name: z
    .string({ error: "name is required" })
    .trim()
    .min(1, { error: "name is required" })
    .max(255, { error: "name must be at most 255 characters" }),
  price: z
    .number({ error: "price must be a number" })
    .int({ error: "price must be a whole number" })
    .min(0, { error: "price can't be negative" }),
  // Optional: leave it out (or send null) for a product with no category
  categoryId: dbIdSchema("categoryId").nullable().default(null)
});
