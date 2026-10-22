import type { Response } from "express";
import * as reviewService from "../services/review.services.ts";
import { currentUser } from "../middlewares/auth.middleware.ts";
import type { Checked } from "../types/http.ts";
import type { IdParam } from "../validators/common.validators.ts";
import type { CreateReview, ReviewListQuery, UpdateReview } from "../validators/review.validators.ts";

// GET /products/:id/reviews
export const getReviews = async (req: Checked<IdParam, unknown, ReviewListQuery>, res: Response): Promise<void> => {

  const { summary, reviews, pagination } = await reviewService.listReviews(req.params.id, req.query);

  res.json({
    success: true,
    data: { summary, reviews },
    pagination
  });
};

// POST /products/:id/reviews
export const addReview = async (req: Checked<IdParam, CreateReview>, res: Response): Promise<void> => {

  const review = await reviewService.createReview(currentUser(req).id, req.params.id, req.body);

  res.status(201).json({
    success: true,
    data: review
  });
};

// PATCH /products/:id/reviews/me
export const editMyReview = async (req: Checked<IdParam, UpdateReview>, res: Response): Promise<void> => {

  const review = await reviewService.updateMyReview(currentUser(req).id, req.params.id, req.body);

  res.json({
    success: true,
    data: review
  });
};

// DELETE /products/:id/reviews/me
export const removeMyReview = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  await reviewService.deleteMyReview(currentUser(req).id, req.params.id);

  res.json({
    success: true,
    message: "Review deleted"
  });
};

// DELETE /admin/reviews/:id
export const removeAnyReview = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  await reviewService.deleteReviewById(req.params.id);

  res.json({
    success: true,
    message: "Review deleted"
  });
};
