import { Router } from "express";
import { getWishlist, saveProduct, unsaveProduct } from "../controllers/wishlist.controllers.ts";
import { requireAuth } from "../middlewares/auth.middleware.ts";
import { validate } from "../middlewares/validate.middleware.ts";
import { productIdParamSchema } from "../validators/stock.validators.ts";

const router = Router();

// Each customer sees and changes only their own wishlist
router.use(requireAuth);

router.get("/", getWishlist);
// PUT, not POST: "make sure it's saved". Doing it twice gives the same result.
router.put("/:productId", validate({ params: productIdParamSchema }), saveProduct);
router.delete("/:productId", validate({ params: productIdParamSchema }), unsaveProduct);

export default router;
