import pool from "../config/db.js";

export const getAllProducts = async () => {
  const { rows } = await pool.query(
    "SELECT id, name, price FROM products ORDER BY id"
  );
  return rows;
};

export const getProductById = async (id) => {
  const { rows } = await pool.query(
    "SELECT id, name, price FROM products WHERE id = $1",
    [id]
  );
  return rows[0];
};

export const createProduct = async ({ name, price }) => {
  const { rows } = await pool.query(
    "INSERT INTO products (name, price) VALUES ($1, $2) RETURNING id, name, price",
    [name, price]
  );
  return rows[0];
};

export const deleteProductById = async (id) => {
  const { rowCount } = await pool.query(
    "DELETE FROM products WHERE id = $1",
    [id]
  );
  return rowCount > 0;
}

export const updateProductById = async (id, { name, price }) => {
  const { rows } = await pool.query(
    "UPDATE products SET name = $1, price = $2 WHERE id = $3 RETURNING id, name, price",
    [name, price, id]
  );
  return rows[0];
};
