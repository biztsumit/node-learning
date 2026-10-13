import * as cartService from "../services/cart.services.js";
import * as productService from "../services/product.services.js";
import { MAX_QUANTITY_PER_ITEM } from "../validators/cart.validators.js";
import { AppError } from "../utils/app-error.js";

// Throws if the cart would hold more than the shop has (or more than the per-item limit).
// This is a friendly early check; the final stock check happens at checkout.
const checkAvailable = (product, wantedQuantity) => {
  if (wantedQuantity > product.stock) {
    throw new AppError(
      409,
      product.stock === 0
        ? `"${product.name}" is out of stock`
        : `Only ${product.stock} of "${product.name}" in stock`
    );
  }
  if (wantedQuantity > MAX_QUANTITY_PER_ITEM) {
    throw new AppError(409, `You can have at most ${MAX_QUANTITY_PER_ITEM} of one product in your cart`);
  }
};

const sendCart = async (res, userId) => {
  const cart = await cartService.getCart(userId);

  res.json({
    success: true,
    data: cart
  });
};

// GET /cart
export const getCart = async (req, res) => {
  await sendCart(res, req.user.id);
};

// POST /cart/items  { productId, quantity }
export const addItem = async (req, res) => {

  const userId = req.user.id;
  const { productId, quantity } = req.body;

  const product = await productService.getProductById(productId);

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  const alreadyInCart = await cartService.getCartItemQuantity(userId, productId);
  checkAvailable(product, alreadyInCart + quantity);

  await cartService.addCartItem(userId, productId, quantity);

  await sendCart(res, userId);
};

// PATCH /cart/items/:productId  { quantity }
export const updateItem = async (req, res) => {

  const userId = req.user.id;
  const { productId } = req.params;
  const { quantity } = req.body;

  const product = await productService.getProductById(productId);

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  checkAvailable(product, quantity);

  const updated = await cartService.setCartItemQuantity(userId, productId, quantity);

  if (!updated) {
    throw new AppError(404, "This product is not in your cart");
  }

  await sendCart(res, userId);
};

// DELETE /cart/items/:productId
export const removeItem = async (req, res) => {

  const userId = req.user.id;

  const removed = await cartService.removeCartItem(userId, req.params.productId);

  if (!removed) {
    throw new AppError(404, "This product is not in your cart");
  }

  await sendCart(res, userId);
};

// DELETE /cart
export const clearCart = async (req, res) => {

  await cartService.clearCart(req.user.id);

  await sendCart(res, req.user.id);
};
