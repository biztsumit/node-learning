import { z } from "zod";

export const categorySchema = z.object({
  name: z
    .string({ error: "name is required" })
    .trim()
    .min(1, { error: "name is required" })
    .max(100, { error: "name must be at most 100 characters" })
});
