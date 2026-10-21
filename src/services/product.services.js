import { randomBytes } from "node:crypto";
import pool from "../config/db.js";
import { logger } from "../config/logger.js";
import { withTransaction } from "../db/transaction.js";
import { slugify } from "../utils/slugify.js";
import { PG_UNIQUE_VIOLATION } from "../utils/db-errors.js";
import { productImagePublicId, thumbnailUrl } from "./cloudinary.client.js";
import { enqueue } from "../jobs/queue.js";
import { AppError } from "../utils/app-error.js";
import { listVariants } from "./variant.services.js";
import { setStockContext } from "../db/stock-context.js";
import { afterCursor, cursorPage, timestampKey } from "../utils/cursor.js";

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
    (SELECT COUNT(*)::int FROM product_variants v WHERE v.product_id = p.id) AS variant_count,
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
  // A summary of the variants (kept by the database): the lowest price and the total stock
  price: row.price,
  stock: row.stock,
  variantCount: row.variant_count,
  imageUrl: row.image_url,
  // A small, fast version for product lists (resized by Cloudinary for our own images)
  thumbnailUrl: row.image_url ? thumbnailUrl(row.image_url) : null,
  // NUMERIC comes back from pg as a string ("4.50"), so convert it
  rating: { average: Number(row.rating_avg), count: row.rating_count },
  category: row.category_id
    ? { id: row.category_id, name: row.category_name }
    : null
});

// ORDER BY can't use $1 placeholders, so sort options come from this fixed list only.
// Each is a list of columns ending with p.id, so every product has a unique position
// (products with the same price always come in the same order), which cursors rely on.
// value(row): where a page's last row keeps that column's value, for the next cursor.
const ID = { column: "p.id", type: "uuid", value: (row) => row.id };
const CREATED = { column: "p.created_at", type: "timestamptz", value: (row) => row.created_key };

const SORTS = {
  newest: { direction: "desc", keys: [CREATED, ID] },
  price_asc: { direction: "asc", keys: [{ column: "p.price", type: "integer", value: (row) => row.price }, ID] },
  price_desc: { direction: "desc", keys: [{ column: "p.price", type: "integer", value: (row) => row.price }, ID] },
  name_asc: { direction: "asc", keys: [{ column: "p.name", type: "varchar", value: (row) => row.name }, ID] },
  // Best average first; with equal averages, the one with more reviews wins
  rating_desc: {
    direction: "desc",
    keys: [
      { column: "p.rating_avg", type: "numeric", value: (row) => row.rating_avg },
      { column: "p.rating_count", type: "integer", value: (row) => row.rating_count },
      ID
    ]
  },
  // Best match first ({relevance} is filled in by findProducts). Ties: newest first.
  // The score is a "real"; its text form converts back to exactly the same number.
  relevance: {
    direction: "desc",
    keys: [{ column: "({relevance})", type: "real", value: (row) => row.relevance_key }, CREATED, ID]
  }
};

// -word, "exact phrase" or "a or b": the person wants precise rules, not "close enough"
const usesSearchSyntax = (text) => /(^|\s)-\S|"|\sor\s/i.test(text);

// In LIKE patterns, % and _ are wildcards. Escape them so searching "50%" means the text "50%".
const escapeLike = (text) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

// Two ways to page through: ?page=3 (with totals, for page-number links) or
// ?cursor=<nextCursor> (no totals, fast at any depth: for "load more" and infinite scroll)
export const findProducts = async ({ search, category, minPrice, maxPrice, inStock, sort, page, cursor, limit }) => {

  // Build the WHERE clause from only the filters that were given
  const conditions = [];
  const values = [];

  // Adds a value to the list and returns its placeholder: "$1", "$2", ...
  const addValue = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  // How well each product matches the search, used by sort=relevance.
  // Not a bare "0" without a search: ORDER BY 0 means "the 0th column" to PostgreSQL (an error).
  let relevance = "0::real";

  if (search) {
    const text = addValue(search);
    // websearch_to_tsquery understands what people type in search boxes:
    // "red mug" (both words), "mug or cup", -plastic (without), "exact phrase"
    const words = `websearch_to_tsquery('english', ${text})`;

    // A product matches when any of these is true:
    //   1. the words (or their forms: "lamps" = "lamp") are in the name or description
    //   2. the name looks like the search, typos included ("hedphones")
    //   3. the name contains it as plain text ("T-Sh", "50%")
    // With search syntax, only 1: otherwise "shirt -classic" would still find "Classic shirt" via 2 and 3.
    // With numbers, no 2: to trigrams "iphone 15" looks just like "iPhone 16", and "50" like "500".
    const ways = [`p.search_vector @@ ${words}`];
    if (!usesSearchSyntax(search)) {
      if (!/\d/.test(search)) {
        ways.push(`${text} <% p.name`);
      }
      ways.push(`p.name ILIKE ${addValue(`%${escapeLike(search)}%`)}`);
    }
    conditions.push(`(${ways.join(" OR ")})`);
    // Word matches (name counts more than description, via the A/B weights) plus how close
    // the name is to what was typed (1 = it contains it exactly)
    relevance = `ts_rank(p.search_vector, ${words}) + word_similarity(${text}, p.name)`;
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

  // No sort chosen: best match first when searching, otherwise newest first
  const name = sort ?? (search ? "relevance" : "newest");
  const chosen = {
    name,
    direction: SORTS[name].direction,
    keys: SORTS[name].keys.map((key) => ({ ...key, column: key.column.replace("{relevance}", relevance) }))
  };
  const orderBy = chosen.keys.map((key) => `${key.column} ${chosen.direction.toUpperCase()}`).join(", ");

  // The filters only: the total count must not depend on where the cursor is
  const filterWhere = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const filterValues = [...values];

  if (cursor !== undefined) {
    conditions.push(afterCursor(chosen, cursor, addValue));
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = cursor === undefined ? ((page ?? 1) - 1) * limit : 0;

  // limit + 1: the extra row (if any) tells us there's a next page
  const rowsQuery = pool.query(
    `${SELECT_PRODUCTS.replace("FROM products p", `, ${timestampKey("p.created_at")} AS created_key, (${relevance})::text AS relevance_key
  FROM products p`)} ${where}
     ORDER BY ${orderBy}
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit + 1, offset]
  );

  // With a cursor there's no COUNT(*): counting every match is the slow part of a huge list
  if (cursor !== undefined) {
    const { rows, nextCursor } = cursorPage((await rowsQuery).rows, limit, chosen);
    return { products: rows.map(toProduct), pagination: { limit, nextCursor } };
  }

  // Page numbers: run both queries at the same time, one page of products and the total count
  const [rowsResult, countResult] = await Promise.all([
    rowsQuery,
    pool.query(`SELECT COUNT(*)::int AS total FROM products p ${filterWhere}`, filterValues)
  ]);
  const total = countResult.rows[0].total;
  const { rows, nextCursor } = cursorPage(rowsResult.rows, limit, chosen);

  return {
    products: rows.map(toProduct),
    pagination: {
      page: page ?? 1,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      // Lets a client switch to cursors from here on
      nextCursor
    }
  };
};

// A single product also lists its variants (what customers choose between)
const withVariants = async (row) =>
  row && { ...toProduct(row), variants: await listVariants(row.id) };

export const getProductById = async (id) => {
  const { rows } = await pool.query(`${SELECT_PRODUCTS} WHERE p.id = $1`, [id]);
  return withVariants(rows[0]);
};

export const getProductBySlug = async (slug) => {
  const { rows } = await pool.query(`${SELECT_PRODUCTS} WHERE p.slug = $1`, [slug]);
  return withVariants(rows[0]);
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

// Try slugs until one is free. The UNIQUE rule on slug decides, so two products created
// at the same moment can never get the same slug. Inside a transaction a failed INSERT
// would spoil everything, so each try gets a SAVEPOINT to roll back to.
const insertWithFreeSlug = async (client, { name, description, price, stock, imageUrl, categoryId }) => {
  for (const slug of slugCandidates(name)) {
    await client.query("SAVEPOINT product_slug");
    try {
      const { rows } = await client.query(
        `INSERT INTO products (slug, name, description, price, stock, image_url, category_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [slug, name, description, price, stock, imageUrl, categoryId]
      );
      await client.query("RELEASE SAVEPOINT product_slug");
      return rows[0].id;
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT product_slug");
      const slugTaken = err.code === PG_UNIQUE_VIOLATION && err.constraint === "products_slug_key";
      if (!slugTaken) {
        throw err;
      }
    }
  }
  throw new Error(`Could not find a free slug for "${name}"`);
};

// Creates the product AND its default variant (no options) in one transaction, so there's
// never a product without anything to buy. Add more variants with POST /products/:id/variants.
// adminId: who did it, for the stock ledger
export const createProduct = async ({ name, description, price, stock, imageUrl, categoryId }, adminId) => {

  const productId = await withTransaction(async (client) => {
    const id = await insertWithFreeSlug(client, { name, description, price, stock, imageUrl, categoryId });
    await setStockContext(client, { reason: "initial", userId: adminId });
    await client.query(
      "INSERT INTO product_variants (product_id, price, stock) VALUES ($1, $2, $3)",
      [id, price, stock]
    );
    return id;
  });

  return getProductById(productId);
};

// When a product's image changes or the product is deleted, remove the old file from
// Cloudinary so unused images don't pile up (and cost storage). Only OUR uploads are
// deleted, never outside links. It's a queued job: it runs after the database change is
// saved, and if Cloudinary is down the queue retries it later instead of giving up.
const removeOldImage = async (previousUrl, currentUrl) => {
  const publicId = productImagePublicId(previousUrl);
  if (!publicId || previousUrl === currentUrl) {
    return;
  }
  try {
    await enqueue("delete-image", { publicId });
  } catch (err) {
    // Only reached without a running queue (tests/scripts) or if the job couldn't be saved
    logger.warn({ err, publicId }, "Could not delete old product image from Cloudinary");
  }
};

// Lock → read the current image → change, in one transaction. Returns the image that was
// replaced, or undefined if there's no such product. (Locking matters: if two admins change
// the same product at once, each must see the image the OTHER one just set, or a file would
// be left behind in Cloudinary.)
const updateAndGetPreviousImage = (id, change) =>
  withTransaction(async (client) => {
    const { rows } = await client.query("SELECT image_url FROM products WHERE id = $1 FOR UPDATE", [id]);
    if (rows.length === 0) {
      return undefined;
    }
    await change(client);
    return { previousImageUrl: rows[0].image_url };
  });

// The slug is NOT changed on update, so links to the product keep working after a rename.
// price/stock (optional) belong to the variant: allowed only for a product with ONE variant.
export const updateProductById = async (id, { name, description, price, stock, imageUrl, categoryId }, adminId) => {
  const result = await updateAndGetPreviousImage(id, async (client) => {
    await client.query(
      "UPDATE products SET name = $1, description = $2, image_url = $3, category_id = $4 WHERE id = $5",
      [name, description, imageUrl, categoryId, id]
    );

    if (price !== undefined || stock !== undefined) {
      const { rows: variants } = await client.query(
        "SELECT id FROM product_variants WHERE product_id = $1 FOR UPDATE",
        [id]
      );
      if (variants.length !== 1) {
        throw new AppError(409, `This product has ${variants.length} variants: change price and stock on each variant instead`);
      }
      // Setting a new total is a "correction" in the ledger (for deliveries, use a stock movement)
      await setStockContext(client, { reason: "correction", userId: adminId });
      await client.query(
        "UPDATE product_variants SET price = COALESCE($1, price), stock = COALESCE($2, stock) WHERE id = $3",
        [price ?? null, stock ?? null, variants[0].id]
      );
    }
  });
  if (!result) {
    return undefined;
  }
  await removeOldImage(result.previousImageUrl, imageUrl);
  return getProductById(id);
};

// Sets (or, with null, removes) just the product's image
export const setProductImage = async (id, imageUrl) => {
  const result = await updateAndGetPreviousImage(id, (client) =>
    client.query("UPDATE products SET image_url = $1 WHERE id = $2", [imageUrl, id])
  );
  if (!result) {
    return undefined;
  }
  await removeOldImage(result.previousImageUrl, imageUrl);
  return getProductById(id);
};

export const deleteProductById = async (id) => {
  const { rows } = await pool.query(
    "DELETE FROM products WHERE id = $1 RETURNING image_url",
    [id]
  );
  if (rows.length === 0) {
    return false;
  }
  await removeOldImage(rows[0].image_url, null);
  return true;
};
