import pool from "../config/db.js";
import { queryWithContext } from "../db/transaction.ts";
import type { Category as CategoryInput } from "../validators/category.validators.ts";

// One row of "SELECT id, name FROM categories". The database doesn't check this for us:
// it must match the columns each query below returns.
export type Category = {
  id: string;
  name: string;
};

export const getAllCategories = async (): Promise<Category[]> => {
  const { rows } = await pool.query<Category>(
    "SELECT id, name FROM categories ORDER BY name"
  );
  return rows;
};

export const getCategoryById = async (id: string): Promise<Category | undefined> => {
  const { rows } = await pool.query<Category>(
    "SELECT id, name FROM categories WHERE id = $1",
    [id]
  );
  return rows[0];
};

export const createCategory = async ({ name }: CategoryInput): Promise<Category | undefined> => {
  const { rows } = await queryWithContext<Category>(
    "INSERT INTO categories (name) VALUES ($1) RETURNING id, name",
    [name]
  );
  return rows[0];
};

// undefined = no such category
export const updateCategoryById = async (id: string, { name }: CategoryInput): Promise<Category | undefined> => {
  const { rows } = await queryWithContext<Category>(
    "UPDATE categories SET name = $1 WHERE id = $2 RETURNING id, name",
    [name, id]
  );
  return rows[0];
};

export const deleteCategoryById = async (id: string): Promise<boolean> => {
  const { rowCount } = await queryWithContext(
    "DELETE FROM categories WHERE id = $1",
    [id]
  );
  // rowCount is null for commands that don't count rows; a DELETE always does
  return (rowCount ?? 0) > 0;
};
