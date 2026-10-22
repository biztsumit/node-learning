import { Router } from "express";
import {
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart
} from "../controllers/cart.controllers.ts";
import { requireAuth } from "../middlewares/auth.middleware.ts";
import { idempotency } from "../middlewares/idempotency.middleware.ts";
import { validate } from "../middlewares/validate.middleware.ts";
import { idParamSchema } from "../validators/common.validators.ts";
import { cartQuerySchema } from "../validators/coupon.validators.ts";
import {
  addCartItemSchema,
  updateCartItemSchema
} from "../validators/cart.validators.ts";

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
