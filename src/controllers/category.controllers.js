import * as categoryService from "../services/category.services.js";
import { catalogCache } from "../cache/catalog-cache.js";
import { AppError } from "../utils/app-error.js";
import { PG_UNIQUE_VIOLATION, PG_RESTRICT_VIOLATION } from "../utils/db-errors.js";

// Turns database rule violations into friendly errors
const handleDbError = (err) => {
  // UNIQUE on categories.name
  if (err.code === PG_UNIQUE_VIOLATION) {
    throw new AppError(409, "A category with this name already exists");
  }
  // ON DELETE RESTRICT: products still point at this category
  if (err.code === PG_RESTRICT_VIOLATION) {
    throw new AppError(409, "Category still has products. Move or delete them first");
  }
  throw err;
};

export const getCategories = async (req, res) => {

  // Cached like products (X-Cache: HIT / MISS)
  const { value: categories, hit } = await catalogCache.wrap("categories", () => categoryService.getAllCategories());
  if (catalogCache.enabled) {
    res.set("X-Cache", hit ? "HIT" : "MISS");
  }

  res.json({
    success: true,
    data: categories
  });
};

export const getCategory = async (req, res) => {

  const category = await categoryService.getCategoryById(req.params.id);

  if (!category) {
    throw new AppError(404, "Category not found");
  }

  res.json({
    success: true,
    data: category
  });
};

export const addCategory = async (req, res) => {

  const category = await categoryService.createCategory(req.body).catch(handleDbError);

  res.status(201).json({
    success: true,
    data: category
  });
};

export const updateCategory = async (req, res) => {

  const category = await categoryService
    .updateCategoryById(req.params.id, req.body)
    .catch(handleDbError);

  if (!category) {
    throw new AppError(404, "Category not found");
  }

  res.json({
    success: true,
    data: category
  });
};

export const deleteCategory = async (req, res) => {

  const deleted = await categoryService
    .deleteCategoryById(req.params.id)
    .catch(handleDbError);

  if (!deleted) {
    throw new AppError(404, "Category not found");
  }

  res.json({
    success: true,
    message: "Category deleted successfully"
  });
};
