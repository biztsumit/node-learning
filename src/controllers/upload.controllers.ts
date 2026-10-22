import type { Request, Response } from "express";
import { createProductImageUpload } from "../services/cloudinary.client.ts";
import * as productService from "../services/product.services.ts";
import { AppError } from "../utils/app-error.ts";
import type { Checked } from "../types/http.ts";
import type { IdParam } from "../validators/common.validators.ts";
import type { ProductImage } from "../validators/upload.validators.ts";

// POST /admin/uploads/product-image — step 1: permission to upload one image to Cloudinary
export const signProductImageUpload = (req: Request, res: Response): void => {
  res.json({
    success: true,
    data: createProductImageUpload()
  });
};

// PATCH /products/:id/image — step 3: attach the uploaded image to a product
export const setImage = async (req: Checked<IdParam, ProductImage>, res: Response): Promise<void> => {

  const product = await productService.setProductImage(req.params.id, req.body.imageUrl);

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  res.json({
    success: true,
    data: product
  });
};
