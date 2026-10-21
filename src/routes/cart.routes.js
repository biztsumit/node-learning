import { Router } from "express";
import {
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart
} from "../controllers/cart.controllers.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { idempotency } from "../middlewares/idempotency.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { idParamSchema } from "../validators/common.validators.js";
import { cartQuerySchema } from "../validators/coupon.validators.js";
import {
  addCartItemSchema,
  updateCartItemSchema
} from "../validators/cart.validators.js";

const router = Router();

// Every cart route needs a logged-in user, so add the guard once for the whole router
router.use(requireAuth);

// ?coupon=CODE previews a discount
router.get("/", validate({ query: cartQuerySchema }), getCart);
router.delete("/", clearCart);
// Idempotency-Key: a retried "add to cart" doesn't add the quantity twice
router.post("/items", idempotency, validate({ body: addCartItemSchema }), addItem);
// :id = the line's variant id (or the product id, if the cart has only one option of it)
router.patch("/items/:id", validate({ params: idParamSchema, body: updateCartItemSchema }), updateItem);
router.delete("/items/:id", validate({ params: idParamSchema }), removeItem);

export default router;
