import { Router } from "express";
import { getStockMovements, addStockMovement } from "../controllers/stock.controllers.ts";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.ts";
import { validate } from "../middlewares/validate.middleware.ts";
import { stockAdjustmentSchema, stockMovementListQuerySchema } from "../validators/stock.validators.ts";

const router = Router();

// Admins only: the stock ledger, and adjusting stock with a reason
router.use(requireAuth, requireAdmin);

router.get("/", validate({ query: stockMovementListQuerySchema }), getStockMovements);
router.post("/", validate({ body: stockAdjustmentSchema }), addStockMovement);

export default router;
