import type { Request, Response } from "express";
import * as wishlistService from "../services/wishlist.services.ts";
import { AppError } from "../utils/app-error.ts";
import { currentUser } from "../middlewares/auth.middleware.ts";
import type { Checked } from "../types/http.ts";
import type { ProductIdParam } from "../validators/stock.validators.ts";

const sendWishlist = async (res: Response, userId: string): Promise<void> => {
  const items = await wishlistService.getWishlist(userId);

  res.json({
    success: true,
    data: items
  });
};

// GET /wishlist
export const getWishlist = async (req: Request, res: Response): Promise<void> => {
  await sendWishlist(res, currentUser(req).id);
};

// PUT /wishlist/:productId
export const saveProduct = async (req: Checked<ProductIdParam>, res: Response): Promise<void> => {
  const userId = currentUser(req).id;
  await wishlistService.addToWishlist(userId, req.params.productId);
  await sendWishlist(res, userId);
};

// DELETE /wishlist/:productId
export const unsaveProduct = async (req: Checked<ProductIdParam>, res: Response): Promise<void> => {
  const userId = currentUser(req).id;
  const removed = await wishlistService.removeFromWishlist(userId, req.params.productId);

  if (!removed) {
    throw new AppError(404, "That product isn't in your wishlist");
  }
  await sendWishlist(res, userId);
};
