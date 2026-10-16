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
import {
  addCartItemSchema,
  updateCartItemSchema,
  productIdParamSchema
} from "../validators/cart.validators.js";

const router = Router();

// Every cart route needs a logged-in user, so add the guard once for the whole router
router.use(requireAuth);

router.get("/", getCart);
router.delete("/", clearCart);
// Idempotency-Key: a retried "add to cart" doesn't add the quantity twice
router.post("/items", idempotency, validate({ body: addCartItemSchema }), addItem);
router.patch("/items/:productId", validate({ params: productIdParamSchema, body: updateCartItemSchema }), updateItem);
router.delete("/items/:productId", validate({ params: productIdParamSchema }), removeItem);

export default router;
