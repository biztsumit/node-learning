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
    p.rating_avg,
    p.rating_count,
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
  // NUMERIC comes back from pg as a string ("4.50"), so convert it
  rating: { average: Number(row.rating_avg), count: row.rating_count },
  category: row.category_id
    ? { id: row.category_id, name: row.category_name }
    : null
});

// ORDER BY can't use $1 placeholders, so sort options come from this fixed list only.
// Each ends with p.id so products with the same price/name always come in the same order.
const SORT_OPTIONS = {
  newest: "p.created_at DESC, p.id DESC",
  price_asc: "p.price ASC, p.id ASC",
  price_desc: "p.price DESC, p.id DESC",
  name_asc: "p.name ASC, p.id ASC",
  // Best average first; with equal averages, the one with more reviews wins
  rating_desc: "p.rating_avg DESC, p.rating_count DESC, p.id DESC"
};

// In LIKE patterns, % and _ are wildcards. Escape them so searching "50%" means the text "50%".
const escapeLike = (text) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

export const findProducts = async ({ search, category, minPrice, maxPrice, inStock, sort, page, limit }) => {

  // Build the WHERE clause from only the filters that were given
  const conditions = [];
  const values = [];

  // Adds a value to the list and returns its placeholder: "$1", "$2", ...
  const addValue = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (search) {
    const pattern = addValue(`%${escapeLike(search)}%`);
    conditions.push(`(p.name ILIKE ${pattern} OR p.description ILIKE ${pattern})`);
  }
  if (category !== undefined) {
    conditions.push(`p.category_id = ${addValue(category)}`);
  }
  if (minPrice !== undefined) {
    conditions.push(`p.price >= ${addValue(minPrice)}`);
  }
  if (maxPrice !== undefined) {
    conditions.push(`p.price <= ${addValue(maxPrice)}`);
  }
  if (inStock !== undefined) {
    conditions.push(inStock ? "p.stock > 0" : "p.stock = 0");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * limit;

  // Run both queries at the same time: one page of products, and the total count
  const [rowsResult, countResult] = await Promise.all([
    pool.query(
      `${SELECT_PRODUCTS} ${where}
       ORDER BY ${SORT_OPTIONS[sort]}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM products p ${where}`, values)
  ]);

  const total = countResult.rows[0].total;

  return {
    products: rowsResult.rows.map(toProduct),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
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
