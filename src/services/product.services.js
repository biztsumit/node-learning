import { randomBytes } from "node:crypto";
import pool from "../config/db.js";
import { slugify } from "../utils/slugify.js";
import { PG_UNIQUE_VIOLATION } from "../utils/db-errors.js";

// LEFT JOIN keeps products that have no category (their category columns come back as NULL)
const SELECT_PRODUCTS = `
  SELECT
    p.id,
    p.slug,
    p.name,
    p.description,
    p.price,
    p.stock,
    p.image_url,
    c.id AS category_id,
    c.name AS category_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
`;

// Turns a flat database row into the shape the API sends back
const toProduct = (row) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  price: row.price,
  stock: row.stock,
  imageUrl: row.image_url,
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

export const getProductBySlug = async (slug) => {
  const { rows } = await pool.query(`${SELECT_PRODUCTS} WHERE p.slug = $1`, [slug]);
  return rows[0] && toProduct(rows[0]);
};

// "t-shirt", then "t-shirt-2" ... "t-shirt-9", then "t-shirt-a1b2c3"
const slugCandidates = function* (name) {
  const base = slugify(name);
  yield base;
  for (let n = 2; n <= 9; n++) {
    yield `${base}-${n}`;
  }
  yield `${base}-${randomBytes(3).toString("hex")}`;
};

export const createProduct = async ({ name, description, price, stock, imageUrl, categoryId }) => {

  // Try slugs until one is free. The UNIQUE rule on slug decides, so two
  // products created at the same moment can never end up with the same slug.
  for (const slug of slugCandidates(name)) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO products (slug, name, description, price, stock, image_url, category_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [slug, name, description, price, stock, imageUrl, categoryId]
      );
      return getProductById(rows[0].id);
    } catch (err) {
      const slugTaken = err.code === PG_UNIQUE_VIOLATION && err.constraint === "products_slug_key";
      if (!slugTaken) {
        throw err;
      }
    }
  }

  throw new Error(`Could not find a free slug for "${name}"`);
};

// The slug is NOT changed on update, so links to the product keep working after a rename
export const updateProductById = async (id, { name, description, price, stock, imageUrl, categoryId }) => {
  const { rowCount } = await pool.query(
    `UPDATE products
     SET name = $1, description = $2, price = $3, stock = $4, image_url = $5, category_id = $6
     WHERE id = $7`,
    [name, description, price, stock, imageUrl, categoryId, id]
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
