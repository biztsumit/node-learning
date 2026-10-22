import type { Response } from "express";
import * as couponService from "../services/coupon.services.ts";
import { AppError } from "../utils/app-error.ts";
import type { Checked } from "../types/http.ts";
import type { IdParam } from "../validators/common.validators.ts";
import type { CouponListQuery, CreateCoupon, UpdateCoupon } from "../validators/coupon.validators.ts";

// GET /admin/coupons
export const getCoupons = async (req: Checked<Record<string, never>, unknown, CouponListQuery>, res: Response): Promise<void> => {

  const { coupons, pagination } = await couponService.listCoupons(req.query);

  res.json({
    success: true,
    data: coupons,
    pagination
  });
};

// GET /admin/coupons/:id
export const getCoupon = async (req: Checked<IdParam>, res: Response): Promise<void> => {

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
export const addCoupon = async (req: Checked<Record<string, never>, CreateCoupon>, res: Response): Promise<void> => {

  const coupon = await couponService.createCoupon(req.body);

  res.status(201).json({
    success: true,
    data: coupon
  });
};

// PATCH /admin/coupons/:id
export const editCoupon = async (req: Checked<IdParam, UpdateCoupon>, res: Response): Promise<void> => {

  const coupon = await couponService.updateCoupon(req.params.id, req.body);

  res.json({
    success: true,
    data: coupon
  });
};

// DELETE /admin/coupons/:id
export const removeCoupon = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  await couponService.deleteCoupon(req.params.id);

  res.json({
    success: true,
    message: "Coupon deleted"
  });
};
