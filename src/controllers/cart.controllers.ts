import type { Request, Response } from "express";
import * as cartService from "../services/cart.services.ts";
import { previewCoupon } from "../services/coupon.services.ts";
import { optionsLabel, type VariantOptions } from "../services/variant.services.ts";
import { MAX_QUANTITY_PER_ITEM, type AddCartItem, type UpdateCartItem } from "../validators/cart.validators.ts";
import { AppError } from "../utils/app-error.ts";
import { currentUser } from "../middlewares/auth.middleware.ts";
import type { Checked } from "../types/http.ts";
import type { IdParam } from "../validators/common.validators.ts";
import type { CartQuery } from "../validators/coupon.validators.ts";

// What the availability check needs: works for a chosen variant AND for an existing cart line
type Available = { name: string; options: VariantOptions; stock: number };

// "T-Shirt" or "T-Shirt (Size: M)"
const displayName = (variant: Available): string =>
  Object.keys(variant.options).length > 0 ? `${variant.name} (${optionsLabel(variant.options)})` : variant.name;

// Throws if the cart would hold more than the shop has (or more than the per-item limit).
// This is a friendly early check; the final stock check happens at checkout.
const checkAvailable = (variant: Available, wantedQuantity: number): void => {
  if (wantedQuantity > variant.stock) {
    throw new AppError(
      409,
      variant.stock === 0
        ? `"${displayName(variant)}" is out of stock`
        : `Only ${variant.stock} of "${displayName(variant)}" in stock`
    );
  }
  if (wantedQuantity > MAX_QUANTITY_PER_ITEM) {
    throw new AppError(409, `You can have at most ${MAX_QUANTITY_PER_ITEM} of one product in your cart`);
  }
};

// couponCode (optional): also show what that coupon would save. Nothing is reserved:
// the coupon is checked again, for real, at checkout.
const sendCart = async (res: Response, userId: string, couponCode?: string): Promise<void> => {
  const cart = await cartService.getCart(userId);
  const coupon = couponCode && cart.items.length > 0
    ? await previewCoupon(userId, couponCode, cart.subtotal)
    : null;
  const discount = coupon?.discount ?? 0;

  res.json({
    success: true,
    data: { ...cart, coupon, discount, total: cart.subtotal - discount }
  });
};

// GET /cart?coupon=WELCOME10
export const getCart = async (req: Checked<Record<string, never>, unknown, CartQuery>, res: Response): Promise<void> => {
  await sendCart(res, currentUser(req).id, req.query.coupon);
};

// POST /cart/items  { productId, variantId?, quantity }
export const addItem = async (req: Checked<Record<string, never>, AddCartItem>, res: Response): Promise<void> => {

  const userId = currentUser(req).id;
  const { productId, variantId, quantity } = req.body;

  const variant = await cartService.resolveVariant(productId, variantId);

  const alreadyInCart = await cartService.getCartItemQuantity(userId, variant.id);
  checkAvailable(variant, alreadyInCart + quantity);

  await cartService.addCartItem(userId, productId, variant.id, quantity);

  await sendCart(res, userId);
};

// PATCH /cart/items/:id  { quantity }   (id = a variant id, or a product id if unambiguous)
export const updateItem = async (req: Checked<IdParam, UpdateCartItem>, res: Response): Promise<void> => {

  const userId = currentUser(req).id;
  const line = await cartService.findCartLine(userId, req.params.id);

  if (!line) {
    throw new AppError(404, "This product is not in your cart");
  }

  checkAvailable(line, req.body.quantity);
  await cartService.setCartItemQuantity(userId, line.variant_id, req.body.quantity);

  await sendCart(res, userId);
};

// DELETE /cart/items/:id
export const removeItem = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  const userId = currentUser(req).id;
  const line = await cartService.findCartLine(userId, req.params.id);

  if (!line) {
    throw new AppError(404, "This product is not in your cart");
  }

  await cartService.removeCartItem(userId, line.variant_id);

  await sendCart(res, userId);
};

// DELETE /cart
export const clearCart = async (req: Request, res: Response): Promise<void> => {

  const userId = currentUser(req).id;
  await cartService.clearCart(userId);

  await sendCart(res, userId);
};
