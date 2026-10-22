import type { Response } from "express";
import * as variantService from "../services/variant.services.ts";
import { AppError } from "../utils/app-error.ts";
import { currentUser } from "../middlewares/auth.middleware.ts";
import type { Checked } from "../types/http.ts";
import type { IdParam } from "../validators/common.validators.ts";
import type { CreateVariant, UpdateVariant, VariantParams } from "../validators/variant.validators.ts";

// GET /products/:id/variants (public)
export const getVariants = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  const variants = await variantService.listVariants(req.params.id);

  if (variants.length === 0) {
    throw new AppError(404, "Product not found");
  }

  res.json({
    success: true,
    data: variants
  });
};

// POST /products/:id/variants (admin)
export const addVariant = async (req: Checked<IdParam, CreateVariant>, res: Response): Promise<void> => {

  const variant = await variantService.createVariant(req.params.id, req.body, currentUser(req).id);

  res.status(201).json({
    success: true,
    data: variant
  });
};

// PATCH /products/:id/variants/:variantId (admin)
export const editVariant = async (req: Checked<VariantParams, UpdateVariant>, res: Response): Promise<void> => {

  const variant = await variantService.updateVariant(req.params.id, req.params.variantId, req.body, currentUser(req).id);

  res.json({
    success: true,
    data: variant
  });
};

// DELETE /products/:id/variants/:variantId (admin)
export const removeVariant = async (req: Checked<VariantParams>, res: Response): Promise<void> => {

  await variantService.deleteVariant(req.params.id, req.params.variantId);

  res.json({
    success: true,
    message: "Variant deleted"
  });
};
