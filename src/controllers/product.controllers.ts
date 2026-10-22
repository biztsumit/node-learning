import type { Response } from "express";
import * as productService from "../services/product.services.ts";
import { cacheKey, catalogCache } from "../cache/catalog-cache.js";
import { AppError } from "../utils/app-error.ts";
import { PG_FOREIGN_KEY_VIOLATION, isDatabaseError } from "../utils/db-errors.ts";
import { currentUser } from "../middlewares/auth.middleware.ts";
import type { Checked } from "../types/http.ts";
import type { IdParam, SlugParam } from "../validators/common.validators.ts";
import type { Product as ProductInput, ProductListQuery, ProductUpdate } from "../validators/product.validators.ts";

// categoryId points at a category that doesn't exist
const handleDbError = (err: unknown): never => {
  if (isDatabaseError(err) && err.code === PG_FOREIGN_KEY_VIOLATION) {
    throw new AppError(400, "Validation failed", [
      { field: "categoryId", message: "category does not exist" }
    ]);
  }
  throw err;
};

// Public reads are cached. X-Cache: HIT means it came from memory, MISS from the database.
// (Changes clear the cache straight away; see src/cache/invalidation.js)
// <T>: returns whatever load() returns, with its type
const cached = async <T>(res: Response, key: string, load: () => Promise<T>): Promise<T> => {
  const { value, hit } = await catalogCache.wrap(key, load);
  if (catalogCache.enabled) {
    res.set("X-Cache", hit ? "HIT" : "MISS");
  }
  return value as T;
};

export const getProducts = async (req: Checked<Record<string, never>, unknown, ProductListQuery>, res: Response): Promise<void> => {

  const { products, pagination } = await cached(res, cacheKey("products", req.query), () =>
    productService.findProducts(req.query)
  );

  res.json({
    success: true,
    data: products,
    pagination
  });
};

export const getProduct = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  const product = await cached(res, `product:${req.params.id}`, () =>
    productService.getProductById(req.params.id)
  );

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  res.json({
    success: true,
    data: product
  });
};

export const getProductBySlug = async (req: Checked<SlugParam>, res: Response): Promise<void> => {

  const product = await cached(res, `product-slug:${req.params.slug}`, () =>
    productService.getProductBySlug(req.params.slug)
  );

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  res.json({
    success: true,
    data: product
  });
};

export const addProduct = async (req: Checked<Record<string, never>, ProductInput>, res: Response): Promise<void> => {

  const product = await productService
    .createProduct(req.body, currentUser(req).id)
    .catch(handleDbError);

  res.status(201).json({
    success: true,
    data: product
  });
};

export const updateProduct = async (req: Checked<IdParam, ProductUpdate>, res: Response): Promise<void> => {

  const product = await productService
    .updateProductById(req.params.id, req.body, currentUser(req).id)
    .catch(handleDbError);

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  res.json({
    success: true,
    data: product
  });
};

export const deleteProduct = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  const deleted = await productService.deleteProductById(req.params.id);

  if (!deleted) {
    throw new AppError(404, "Product not found");
  }

  res.json({
    success: true,
    message: "Product deleted successfully"
  });
};
