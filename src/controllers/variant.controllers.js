import * as variantService from "../services/variant.services.js";
import { AppError } from "../utils/app-error.js";

// GET /products/:id/variants (public)
export const getVariants = async (req, res) => {

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
export const addVariant = async (req, res) => {

  const variant = await variantService.createVariant(req.params.id, req.body);

  res.status(201).json({
    success: true,
    data: variant
  });
};

// PATCH /products/:id/variants/:variantId (admin)
export const editVariant = async (req, res) => {

  const variant = await variantService.updateVariant(req.params.id, req.params.variantId, req.body);

  res.json({
    success: true,
    data: variant
  });
};

// DELETE /products/:id/variants/:variantId (admin)
export const removeVariant = async (req, res) => {

  await variantService.deleteVariant(req.params.id, req.params.variantId);

  res.json({
    success: true,
    message: "Variant deleted"
  });
};
