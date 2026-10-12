import pool from "../config/db.js";

export const getAllCategories = async () => {
  const { rows } = await pool.query(
    "SELECT id, name FROM categories ORDER BY name"
  );
  return rows;
};

export const getCategoryById = async (id) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM categories WHERE id = $1",
    [id]
  );
  return rows[0];
};

export const createCategory = async ({ name }) => {
  const { rows } = await pool.query(
    "INSERT INTO categories (name) VALUES ($1) RETURNING id, name",
    [name]
  );
  return rows[0];
};

export const updateCategoryById = async (id, { name }) => {
  const { rows } = await pool.query(
    "UPDATE categories SET name = $1 WHERE id = $2 RETURNING id, name",
    [name, id]
  );
  return rows[0];
};

export const deleteCategoryById = async (id) => {
  const { rowCount } = await pool.query(
    "DELETE FROM categories WHERE id = $1",
    [id]
  );
  return rowCount > 0;
};
