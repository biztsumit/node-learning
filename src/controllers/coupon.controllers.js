import * as couponService from "../services/coupon.services.js";
import { AppError } from "../utils/app-error.ts";

// GET /admin/coupons
export const getCoupons = async (req, res) => {

  const { coupons, pagination } = await couponService.listCoupons(req.query);

  res.json({
    success: true,
    data: coupons,
    pagination
  });
};

// GET /admin/coupons/:id
export const getCoupon = async (req, res) => {

  const coupon = await couponService.getCoupon(req.params.id);

  if (!coupon) {
    throw new AppError(404, "Coupon not found");
  }

  res.json({
    success: true,
    data: coupon
  });
};

// POST /admin/coupons
export const addCoupon = async (req, res) => {

  const coupon = await couponService.createCoupon(req.body);

  res.status(201).json({
    success: true,
    data: coupon
  });
};

// PATCH /admin/coupons/:id
export const editCoupon = async (req, res) => {

  const coupon = await couponService.updateCoupon(req.params.id, req.body);

  res.json({
    success: true,
    data: coupon
  });
};

// DELETE /admin/coupons/:id
export const removeCoupon = async (req, res) => {

  await couponService.deleteCoupon(req.params.id);

  res.json({
    success: true,
    message: "Coupon deleted"
  });
};
