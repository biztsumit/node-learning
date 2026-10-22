import * as wishlistService from "../services/wishlist.services.js";
import { AppError } from "../utils/app-error.ts";

const sendWishlist = async (res, userId) => {
  const items = await wishlistService.getWishlist(userId);

  res.json({
    success: true,
    data: items
  });
};

// GET /wishlist
export const getWishlist = async (req, res) => {
  await sendWishlist(res, req.user.id);
};

// PUT /wishlist/:productId
export const saveProduct = async (req, res) => {
  await wishlistService.addToWishlist(req.user.id, req.params.productId);
  await sendWishlist(res, req.user.id);
};

// DELETE /wishlist/:productId
export const unsaveProduct = async (req, res) => {
  const removed = await wishlistService.removeFromWishlist(req.user.id, req.params.productId);

  if (!removed) {
    throw new AppError(404, "That product isn't in your wishlist");
  }
  await sendWishlist(res, req.user.id);
};
