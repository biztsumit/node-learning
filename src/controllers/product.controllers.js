import * as productService from "../services/product.services.js";
import { cacheKey, catalogCache } from "../cache/catalog-cache.js";
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

// Public reads are cached. X-Cache: HIT means it came from memory, MISS from the database.
// (Changes clear the cache straight away; see src/cache/invalidation.js)
const cached = async (res, key, load) => {
  const { value, hit } = await catalogCache.wrap(key, load);
  if (catalogCache.enabled) {
    res.set("X-Cache", hit ? "HIT" : "MISS");
  }
  return value;
};

export const getProducts = async (req, res) => {

  const { products, pagination } = await cached(res, cacheKey("products", req.query), () =>
    productService.findProducts(req.query)
  );

  res.json({
    success: true,
    data: products,
    pagination
  });
};

export const getProduct = async (req, res) => {

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

export const getProductBySlug = async (req, res) => {

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

export const addProduct = async (req, res) => {

  const product = await productService
    .createProduct(req.body, req.user.id)
    .catch(handleDbError);

  res.status(201).json({
    success: true,
    data: product
  });
};

export const updateProduct = async (req, res) => {

  const product = await productService
    .updateProductById(req.params.id, req.body, req.user.id)
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
