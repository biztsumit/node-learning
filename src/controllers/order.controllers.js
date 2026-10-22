import * as orderService from "../services/order.services.ts";
import { AppError } from "../utils/app-error.ts";

// ---------- Customers (only ever their own orders) ----------

// POST /orders  { addressId? } — checkout: turns the cart into an order
export const placeOrder = async (req, res) => {

  const order = await orderService.checkout(req.user.id, req.body);

  res.status(201).json({
    success: true,
    data: order
  });
};

// GET /orders
export const getMyOrders = async (req, res) => {

  const { orders, pagination } = await orderService.listOrders({
    ...req.query,
    userId: req.user.id
  });

  res.json({
    success: true,
    data: orders,
    pagination
  });
};

// GET /orders/:id
export const getMyOrder = async (req, res) => {

  const order = await orderService.getOrderById(req.params.id, { userId: req.user.id });

  if (!order) {
    throw new AppError(404, "Order not found");
  }

  res.json({
    success: true,
    data: order
  });
};

// GET /orders/number/:orderNumber
export const getMyOrderByNumber = async (req, res) => {

  const order = await orderService.getOrderByNumber(req.params.orderNumber, { userId: req.user.id });

  if (!order) {
    throw new AppError(404, "Order not found");
  }

  res.json({
    success: true,
    data: order
  });
};

// POST /orders/:id/cancel
export const cancelMyOrder = async (req, res) => {

  const order = await orderService.cancelOrder(req.user.id, req.params.id);

  res.json({
    success: true,
    data: order
  });
};

// ---------- Admins (any order) ----------

// GET /admin/orders
export const getAllOrders = async (req, res) => {

  const { orders, pagination } = await orderService.listOrders(req.query, { includeCustomer: true });

  res.json({
    success: true,
    data: orders,
    pagination
  });
};

// GET /admin/orders/:id
export const getAnyOrder = async (req, res) => {

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
export const updateOrderStatus = async (req, res) => {

  const order = await orderService.changeOrderStatus(req.params.id, req.body.status);

  res.json({
    success: true,
    data: order
  });
};
