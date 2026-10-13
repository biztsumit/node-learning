import pool from "../config/db.js";

// Every query here filters by user_id, so a user can only ever touch their own cart.

export const getCart = async (userId) => {
  const { rows } = await pool.query(
    `SELECT
       ci.product_id,
       ci.quantity,
       p.slug,
       p.name,
       p.price,
       p.stock,
       p.image_url
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = $1
     ORDER BY ci.created_at, ci.id`,
    [userId]
  );

  // Prices are read from products right now, so the cart always shows today's price
  const items = rows.map((row) => ({
    productId: row.product_id,
    slug: row.slug,
    name: row.name,
    price: row.price,
    imageUrl: row.image_url,
    stock: row.stock,
    quantity: row.quantity,
    lineTotal: row.price * row.quantity
  }));

  return {
    items,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0)
  };
};

// How many of this product are already in the user's cart (0 if none)
export const getCartItemQuantity = async (userId, productId) => {
  const { rows } = await pool.query(
    "SELECT quantity FROM cart_items WHERE user_id = $1 AND product_id = $2",
    [userId, productId]
  );
  return rows[0]?.quantity ?? 0;
};

// "Upsert": insert a new row, or if this product is already in the cart, add to its quantity.
// One statement, so two quick clicks on "Add to cart" can't lose an update.
export const addCartItem = async (userId, productId, quantity) => {
  await pool.query(
    `INSERT INTO cart_items (user_id, product_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, product_id)
     DO UPDATE SET
       quantity = cart_items.quantity + EXCLUDED.quantity,
       updated_at = NOW()`,
    [userId, productId, quantity]
  );
};

export const setCartItemQuantity = async (userId, productId, quantity) => {
  const { rowCount } = await pool.query(
    `UPDATE cart_items
     SET quantity = $3, updated_at = NOW()
     WHERE user_id = $1 AND product_id = $2`,
    [userId, productId, quantity]
  );
  return rowCount > 0;
};

export const removeCartItem = async (userId, productId) => {
  const { rowCount } = await pool.query(
    "DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2",
    [userId, productId]
  );
  return rowCount > 0;
};

export const clearCart = async (userId) => {
  await pool.query("DELETE FROM cart_items WHERE user_id = $1", [userId]);
};
