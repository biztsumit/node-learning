import type { Request, Response } from "express";
import * as categoryService from "../services/category.services.ts";
import { catalogCache } from "../cache/catalog-cache.js";
import { AppError } from "../utils/app-error.ts";
import { PG_UNIQUE_VIOLATION, PG_RESTRICT_VIOLATION, isDatabaseError } from "../utils/db-errors.ts";
import type { Checked } from "../types/http.ts";
import type { IdParam } from "../validators/common.validators.ts";
import type { Category as CategoryInput } from "../validators/category.validators.ts";

// Turns database rule violations into friendly errors (": never": it always throws)
const handleDbError = (err: unknown): never => {
  // UNIQUE on categories.name
  if (isDatabaseError(err) && err.code === PG_UNIQUE_VIOLATION) {
    throw new AppError(409, "A category with this name already exists");
  }
  // ON DELETE RESTRICT: products still point at this category
  if (isDatabaseError(err) && err.code === PG_RESTRICT_VIOLATION) {
    throw new AppError(409, "Category still has products. Move or delete them first");
  }
  throw err;
};

export const getCategories = async (req: Request, res: Response): Promise<void> => {

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

export const getCategory = async (req: Checked<IdParam>, res: Response): Promise<void> => {

  const category = await categoryService.getCategoryById(req.params.id);

  if (!category) {
    throw new AppError(404, "Category not found");
  }

  res.json({
    success: true,
    data: category
  });
};

export const addCategory = async (req: Checked<Record<string, never>, CategoryInput>, res: Response): Promise<void> => {

  const category = await categoryService.createCategory(req.body).catch(handleDbError);

  res.status(201).json({
    success: true,
    data: category
  });
};

export const updateCategory = async (req: Checked<IdParam, CategoryInput>, res: Response): Promise<void> => {

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

export const deleteCategory = async (req: Checked<IdParam>, res: Response): Promise<void> => {

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
