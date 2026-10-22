import { Router } from "express";
import {
  getSummary,
  getRevenue,
  getTopProducts,
  getCustomers,
  refreshReports
} from "../controllers/report.controllers.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.ts";
import { validate } from "../middlewares/validate.middleware.js";
import {
  summaryQuerySchema,
  revenueQuerySchema,
  topProductsQuerySchema,
  customersQuerySchema
} from "../validators/report.validators.js";

const router = Router();

// Admins only: the sales dashboard
router.use(requireAuth, requireAdmin);

router.get("/summary", validate({ query: summaryQuerySchema }), getSummary);
router.get("/revenue", validate({ query: revenueQuerySchema }), getRevenue);
router.get("/top-products", validate({ query: topProductsQuerySchema }), getTopProducts);
router.get("/customers", validate({ query: customersQuerySchema }), getCustomers);
router.post("/refresh", refreshReports);

export default router;
