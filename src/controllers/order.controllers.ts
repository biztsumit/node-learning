import type { Response } from "express";
import * as orderService from "../services/order.services.ts";
import { AppError } from "../utils/app-error.ts";
import { currentUser } from "../middlewares/auth.middleware.ts";
import type { Checked } from "../types/http.ts";
import type { IdParam } from "../validators/common.validators.ts";
import type {
  AdminOrderListQuery, Checkout, OrderListQuery, OrderNumberParam, UpdateOrderStatus
} from "../validators/order.validators.ts";

// ---------- Customers (only ever their own orders) ----------

// POST /orders  { addressId?, couponCode? } — checkout: turns the cart into an order
export const placeOrder = async (req: Checked<Record<string, never>, Checkout>, res: Response): Promise<void> => {

  const order = await orderService.checkout(currentUser(req).id, req.body);

  res.status(201).json({
    success: true,
    data: order
  });
};

// GET /orders
export const getMyOrders = async (req: Checked<Record<string, never>, unknown, OrderListQuery>, res: Response): Promise<void> => {

  const { orders, pagination } = await orderService.listOrders({
    ...req.query,
    userId: currentUser(req).id
  });

  res.json({
    success: true,
    data: orders,
    pagination
  });
};

// GET /orders/:id
export const getMyOrder = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  const order = await orderService.getOrderById(req.params.id, { userId: currentUser(req).id });

  if (!order) {
    throw new AppError(404, "Order not found");
  }

  res.json({
    success: true,
    data: order
  });
};

// GET /orders/number/:orderNumber
export const getMyOrderByNumber = async (req: Checked<OrderNumberParam>, res: Response): Promise<void> => {

  const order = await orderService.getOrderByNumber(req.params.orderNumber, { userId: currentUser(req).id });

  if (!order) {
    throw new AppError(404, "Order not found");
  }

  res.json({
    success: true,
    data: order
  });
};

// POST /orders/:id/cancel
export const cancelMyOrder = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  const order = await orderService.cancelOrder(currentUser(req).id, req.params.id);

  res.json({
    success: true,
    data: order
  });
};

// ---------- Admins (any order) ----------

// GET /admin/orders
export const getAllOrders = async (req: Checked<Record<string, never>, unknown, AdminOrderListQuery>, res: Response): Promise<void> => {

  const { orders, pagination } = await orderService.listOrders(req.query, { includeCustomer: true });

  res.json({
    success: true,
    data: orders,
    pagination
  });
};

// GET /admin/orders/:id
export const getAnyOrder = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  const order = await orderService.getOrderById(req.params.id);

  if (!order) {
    throw new AppError(404, "Order not found");
  }

  res.json({
    success: true,
    data: order
  });
};

// PATCH /admin/orders/:id/status
export const updateOrderStatus = async (req: Checked<IdParam, UpdateOrderStatus>, res: Response): Promise<void> => {

  const order = await orderService.changeOrderStatus(req.params.id, req.body.status);

  res.json({
    success: true,
    data: order
  });
};
