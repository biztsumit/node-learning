// A customer's saved-for-later products
import pool from "../config/db.js";
import { AppError } from "../utils/app-error.js";
import { PG_FOREIGN_KEY_VIOLATION } from "../utils/db-errors.js";
import { thumbnailUrl } from "./cloudinary.client.js";

// Plenty for a real person; stops one account from filling the table
export const MAX_WISHLIST_ITEMS = 200;

// Price and stock are read now, so the list shows today's price and "back in stock"
export const getWishlist = async (userId) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.slug, p.name, p.price, p.stock, p.image_url, p.rating_avg, p.rating_count, w.created_at
     FROM wishlist_items w
     JOIN products p ON p.id = w.product_id
     WHERE w.user_id = $1
     ORDER BY w.created_at DESC, p.id`,
    [userId]
  );
  return rows.map((row) => ({
    productId: row.id,
    slug: row.slug,
    name: row.name,
    price: row.price,
    inStock: row.stock > 0,
    thumbnailUrl: row.image_url ? thumbnailUrl(row.image_url) : null,
    rating: { average: Number(row.rating_avg), count: row.rating_count },
    addedAt: row.created_at
  }));
};

// PUT /wishlist/:productId. Saving something already saved changes nothing (ON CONFLICT DO NOTHING):
// a double click or a retried request is harmless. That's what makes it a PUT.
export const addToWishlist = async (userId, productId) => {
  const { rows: [{ count }] } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM wishlist_items WHERE user_id = $1",
    [userId]
  );
  if (count >= MAX_WISHLIST_ITEMS) {
    throw new AppError(409, `Your wishlist is full (${MAX_WISHLIST_ITEMS} products). Remove some first`);
  }
  try {
    await pool.query(
      "INSERT INTO wishlist_items (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userId, productId]
    );
  } catch (err) {
    // The foreign key says the product doesn't exist: no need to look it up first
    if (err.code === PG_FOREIGN_KEY_VIOLATION) {
      throw new AppError(404, "Product not found");
    }
    throw err;
  }
};

export const removeFromWishlist = async (userId, productId) => {
  const { rowCount } = await pool.query(
    "DELETE FROM wishlist_items WHERE user_id = $1 AND product_id = $2",
    [userId, productId]
  );
  return rowCount > 0;
};
