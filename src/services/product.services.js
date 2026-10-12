import pool from "../config/db.js";

// LEFT JOIN keeps products that have no category (their category columns come back as NULL)
const SELECT_PRODUCTS = `
  SELECT
    p.id,
    p.name,
    p.price,
    c.id AS category_id,
    c.name AS category_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
`;

// Turns a flat database row into the shape the API sends back
const toProduct = (row) => ({
  id: row.id,
  name: row.name,
  price: row.price,
  category: row.category_id
    ? { id: row.category_id, name: row.category_name }
    : null
});

export const getAllProducts = async () => {
  const { rows } = await pool.query(`${SELECT_PRODUCTS} ORDER BY p.id`);
  return rows.map(toProduct);
};

export const getProductById = async (id) => {
  const { rows } = await pool.query(`${SELECT_PRODUCTS} WHERE p.id = $1`, [id]);
  return rows[0] && toProduct(rows[0]);
};

export const createProduct = async ({ name, price, categoryId }) => {
  const { rows } = await pool.query(
    "INSERT INTO products (name, price, category_id) VALUES ($1, $2, $3) RETURNING id",
    [name, price, categoryId]
  );
  return getProductById(rows[0].id);
};

export const updateProductById = async (id, { name, price, categoryId }) => {
  const { rowCount } = await pool.query(
    "UPDATE products SET name = $1, price = $2, category_id = $3 WHERE id = $4",
    [name, price, categoryId, id]
  );
  return rowCount > 0 ? getProductById(id) : undefined;
};

export const deleteProductById = async (id) => {
  const { rowCount } = await pool.query(
    "DELETE FROM products WHERE id = $1",
    [id]
  );
  return rowCount > 0;
};
