import * as reviewService from "../services/review.services.js";

// GET /products/:id/reviews
export const getReviews = async (req, res) => {

  const { summary, reviews, pagination } = await reviewService.listReviews(req.params.id, req.query);

  res.json({
    success: true,
    data: { summary, reviews },
    pagination
  });
};

// POST /products/:id/reviews
export const addReview = async (req, res) => {

  const review = await reviewService.createReview(req.user.id, req.params.id, req.body);

  res.status(201).json({
    success: true,
    data: review
  });
};

// PATCH /products/:id/reviews/me
export const editMyReview = async (req, res) => {

  const review = await reviewService.updateMyReview(req.user.id, req.params.id, req.body);

  res.json({
    success: true,
    data: review
  });
};

// DELETE /products/:id/reviews/me
export const removeMyReview = async (req, res) => {

  await reviewService.deleteMyReview(req.user.id, req.params.id);

  res.json({
    success: true,
    message: "Review deleted"
  });
};

// DELETE /admin/reviews/:id
export const removeAnyReview = async (req, res) => {

  await reviewService.deleteReviewById(req.params.id);

  res.json({
    success: true,
    message: "Review deleted"
  });
};
