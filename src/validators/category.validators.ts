import { z } from "zod";

export const categorySchema = z.object({
  name: z
    .string({ error: "name is required" })
    .trim()
    .min(1, { error: "name is required" })
    .max(100, { error: "name must be at most 100 characters" })
});

// The TypeScript types of the CHECKED data (after trimming, defaults, coercion...).
// Services use these, so the shape is written once: in the schema.
export type Category = z.infer<typeof categorySchema>;
