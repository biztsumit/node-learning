import { z } from "zod";
import { paginationFields } from "./common.validators.ts";

const ratingSchema = z
  .number({ error: "rating must be a number" })
  .int({ error: "rating must be a whole number" })
  .min(1, { error: "rating must be between 1 and 5" })
  .max(5, { error: "rating must be between 1 and 5" });

const commentSchema = z
  .string({ error: "comment must be text" })
  .trim()
  .max(2000, { error: "comment must be at most 2000 characters" });

// POST /products/:id/reviews
export const createReviewSchema = z.object({
  rating: ratingSchema,
  comment: commentSchema.default("")
});

// PATCH /products/:id/reviews/me
export const updateReviewSchema = z
  .object({
    rating: ratingSchema,
    comment: commentSchema
  })
  .partial()
  .refine((fields) => Object.keys(fields).length > 0, { error: "Send rating and/or comment to update" });

// GET /products/:id/reviews?sort=highest&page=1
export const reviewListQuerySchema = z.object({
  sort: z
    .enum(["newest", "highest", "lowest"], { error: "sort must be one of: newest, highest, lowest" })
    .default("newest"),
  ...paginationFields
});

// The TypeScript types of the CHECKED data (after trimming, defaults, coercion...).
// Services use these, so the shape is written once: in the schema.
export type CreateReview = z.infer<typeof createReviewSchema>;
export type UpdateReview = z.infer<typeof updateReviewSchema>;
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;
