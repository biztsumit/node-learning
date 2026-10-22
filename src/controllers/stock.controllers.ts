import type { Response } from "express";
import * as stockService from "../services/stock.services.ts";
import { currentUser } from "../middlewares/auth.middleware.ts";
import type { Checked } from "../types/http.ts";
import type { StockAdjustment, StockMovementListQuery } from "../validators/stock.validators.ts";

// GET /admin/stock-movements
export const getStockMovements = async (req: Checked<Record<string, never>, unknown, StockMovementListQuery>, res: Response): Promise<void> => {

  const { movements, pagination } = await stockService.listStockMovements(req.query);

  res.json({
    success: true,
    data: movements,
    pagination
  });
};

// POST /admin/stock-movements
export const addStockMovement = async (req: Checked<Record<string, never>, StockAdjustment>, res: Response): Promise<void> => {

  const movement = await stockService.adjustStock(req.body, currentUser(req).id);

  res.status(201).json({
    success: true,
    data: movement
  });
};
