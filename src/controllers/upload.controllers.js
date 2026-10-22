import { createProductImageUpload } from "../services/cloudinary.client.ts";
import * as productService from "../services/product.services.js";
import { AppError } from "../utils/app-error.ts";

// POST /admin/uploads/product-image — step 1: permission to upload one image to Cloudinary
export const signProductImageUpload = (req, res) => {
  res.json({
    success: true,
    data: createProductImageUpload()
  });
};

// PATCH /products/:id/image — step 3: attach the uploaded image to a product
export const setImage = async (req, res) => {

  const product = await productService.setProductImage(req.params.id, req.body.imageUrl);

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  res.json({
    success: true,
    data: product
  });
};
