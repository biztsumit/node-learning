import * as productService from "../services/product.services.js";
import { AppError } from "../utils/app-error.js";
import { PG_FOREIGN_KEY_VIOLATION } from "../utils/db-errors.js";

// categoryId points at a category that doesn't exist
const handleDbError = (err) => {
  if (err.code === PG_FOREIGN_KEY_VIOLATION) {
    throw new AppError(400, "Validation failed", [
      { field: "categoryId", message: "category does not exist" }
    ]);
  }
  throw err;
};

export const getProducts = async (req, res) => {

  const products = await productService.getAllProducts();

  res.json({
    success: true,
    data: products
  });
};

export const getProduct = async (req, res) => {

  const product = await productService.getProductById(req.params.id);

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  res.json({
    success: true,
    data: product
  });
};

export const addProduct = async (req, res) => {

  const product = await productService
    .createProduct(req.body)
    .catch(handleDbError);

  res.status(201).json({
    success: true,
    data: product
  });
};

export const updateProduct = async (req, res) => {

  const product = await productService
    .updateProductById(req.params.id, req.body)
    .catch(handleDbError);

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  res.json({
    success: true,
    data: product
  });
};

export const deleteProduct = async (req, res) => {

  const deleted = await productService.deleteProductById(req.params.id);

  if (!deleted) {
    throw new AppError(404, "Product not found");
  }

  res.json({
    success: true,
    message: "Product deleted successfully"
  });
};
