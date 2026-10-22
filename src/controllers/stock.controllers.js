import * as stockService from "../services/stock.services.ts";

// GET /admin/stock-movements
export const getStockMovements = async (req, res) => {

  const { movements, pagination } = await stockService.listStockMovements(req.query);

  res.json({
    success: true,
    data: movements,
    pagination
  });
};

// POST /admin/stock-movements
export const addStockMovement = async (req, res) => {

  const movement = await stockService.adjustStock(req.body, req.user.id);

  res.status(201).json({
    success: true,
    data: movement
  });
};
