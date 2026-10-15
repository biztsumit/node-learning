import pool from "../config/db.js";
import { withTransaction } from "../db/transaction.js";
import { AppError } from "../utils/app-error.js";
import { PG_UNIQUE_VIOLATION } from "../utils/db-errors.js";

// "riya sharma" → "Riya S." (a public page shouldn't show customers' full names)
const displayName = (fullName) => {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const last = rest.at(-1);
  const firstName = first[0].toUpperCase() + first.slice(1);
  return last ? `${firstName} ${last[0].toUpperCase()}.` : firstName;
};

const toReview = (row) => ({
  id: row.id,
  rating: row.rating,
  comment: row.comment,
  reviewer: displayName(row.user_name),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const SELECT_REVIEWS = `
  SELECT r.id, r.rating, r.comment, r.created_at, r.updated_at, u.name AS user_name
  FROM reviews r
  JOIN users u ON u.id = r.user_id
`;

const REVIEW_SORT = {
  newest: "r.created_at DESC, r.id DESC",
  highest: "r.rating DESC, r.created_at DESC, r.id DESC",
  lowest: "r.rating ASC, r.created_at DESC, r.id DESC"
};

// ---------- Reading ----------

export const listReviews = async (productId, { sort, page, limit }) => {

  const { rows: [product] } = await pool.query(
    "SELECT rating_avg, rating_count FROM products WHERE id = $1",
    [productId]
  );

  if (!product) {
    throw new AppError(404, "Product not found");
  }

  const [reviewsResult, breakdownResult] = await Promise.all([
    pool.query(
      `${SELECT_REVIEWS}
       WHERE r.product_id = $1
       ORDER BY ${REVIEW_SORT[sort]}
       LIMIT $2 OFFSET $3`,
      [productId, limit, (page - 1) * limit]
    ),
    // How many 5-star, 4-star, ... reviews: one row per rating value
    pool.query(
      `SELECT rating, COUNT(*)::int AS count
       FROM reviews
       WHERE product_id = $1
       GROUP BY rating`,
      [productId]
    )
  ]);

  const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const row of breakdownResult.rows) {
    breakdown[row.rating] = row.count;
  }

  const total = product.rating_count;

  return {
    summary: {
      // NUMERIC comes back from pg as a string ("4.50") to avoid rounding errors; we convert it
      average: Number(product.rating_avg),
      count: total,
      breakdown
    },
    reviews: reviewsResult.rows.map(toReview),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  };
};

// ---------- Writing ----------

// Recalculates the stored average and count from the reviews table.
// Called inside the same transaction as every review change.
const refreshProductRating = (client, productId) =>
  client.query(
    `UPDATE products
     SET rating_avg = COALESCE((SELECT ROUND(AVG(rating), 2) FROM reviews WHERE product_id = $1), 0),
         rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = $1)
     WHERE id = $1`,
    [productId]
  );

// Locks the product row. Every review change for a product takes this lock first,
// so two reviews saved at the same moment can't both calculate the average from stale data.
const lockProduct = async (client, productId) => {
  const { rows } = await client.query("SELECT id FROM products WHERE id = $1 FOR UPDATE", [productId]);
  if (rows.length === 0) {
    throw new AppError(404, "Product not found");
  }
};

// Only customers who actually received the product may review it
const hasReceivedProduct = async (client, userId, productId) => {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.user_id = $1 AND oi.product_id = $2 AND o.status = 'delivered'
     ) AS received`,
    [userId, productId]
  );
  return rows[0].received;
};

const getReviewById = async (client, reviewId) => {
  const { rows } = await client.query(`${SELECT_REVIEWS} WHERE r.id = $1`, [reviewId]);
  return toReview(rows[0]);
};

export const createReview = async (userId, productId, { rating, comment }) => {
  return withTransaction(async (client) => {

    await lockProduct(client, productId);

    if (!(await hasReceivedProduct(client, userId, productId))) {
      throw new AppError(403, "You can only review products from your delivered orders");
    }

    let reviewId;
    try {
      const { rows } = await client.query(
        "INSERT INTO reviews (product_id, user_id, rating, comment) VALUES ($1, $2, $3, $4) RETURNING id",
        [productId, userId, rating, comment]
      );
      reviewId = rows[0].id;
    } catch (err) {
      if (err.code === PG_UNIQUE_VIOLATION) {
        throw new AppError(409, "You've already reviewed this product. Edit your review instead");
      }
      throw err;
    }

    await refreshProductRating(client, productId);
    return getReviewById(client, reviewId);
  });
};

// Edits the logged-in user's own review of this product
export const updateMyReview = async (userId, productId, fields) => {
  return withTransaction(async (client) => {

    await lockProduct(client, productId);

    const { rows } = await client.query(
      `UPDATE reviews
       SET rating = COALESCE($3, rating),
           comment = COALESCE($4, comment),
           updated_at = NOW()
       WHERE product_id = $1 AND user_id = $2
       RETURNING id`,
      [productId, userId, fields.rating ?? null, fields.comment ?? null]
    );

    if (rows.length === 0) {
      throw new AppError(404, "You haven't reviewed this product");
    }

    await refreshProductRating(client, productId);
    return getReviewById(client, rows[0].id);
  });
};

export const deleteMyReview = async (userId, productId) => {
  await withTransaction(async (client) => {

    await lockProduct(client, productId);

    const { rowCount } = await client.query(
      "DELETE FROM reviews WHERE product_id = $1 AND user_id = $2",
      [productId, userId]
    );

    if (rowCount === 0) {
      throw new AppError(404, "You haven't reviewed this product");
    }

    await refreshProductRating(client, productId);
  });
};

// Admins removing any review (e.g. spam or abuse)
export const deleteReviewById = async (reviewId) => {
  await withTransaction(async (client) => {

    const { rows: [review] } = await client.query("SELECT product_id FROM reviews WHERE id = $1", [reviewId]);

    if (!review) {
      throw new AppError(404, "Review not found");
    }

    await lockProduct(client, review.product_id);
    await client.query("DELETE FROM reviews WHERE id = $1", [reviewId]);
    await refreshProductRating(client, review.product_id);
  });
};
