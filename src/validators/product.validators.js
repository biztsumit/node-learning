import { z } from "zod";

export const productSchema = z.object({
  name: z
    .string({ error: "name is required" })
    .trim()
    .min(1, { error: "name is required" })
    .max(255, { error: "name must be at most 255 characters" }),
  price: z
    .number({ error: "price must be a number" })
    .int({ error: "price must be a whole number" })
    .min(0, { error: "price can't be negative" })
});
