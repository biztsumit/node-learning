import pool from "../config/db.js";
import { AppError } from "../utils/app-error.js";
import { optionsLabel } from "./variant.services.js";

// Every query here filters by user_id, so a user can only ever touch their own cart.
// A cart line is one VARIANT (e.g. "T-Shirt, size M"), so one product can appear twice.

export const getCart = async (userId) => {
  const { rows } = await pool.query(
    `SELECT
       ci.product_id,
       ci.variant_id,
       ci.quantity,
       p.slug,
       p.name,
       p.image_url,
       v.options,
       v.price,
       v.stock
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     JOIN product_variants v ON v.id = ci.variant_id
     WHERE ci.user_id = $1
     ORDER BY ci.created_at, ci.id`,
    [userId]
  );

  // Prices are read from the variant right now, so the cart always shows today's price
  const items = rows.map((row) => ({
    productId: row.product_id,
    variantId: row.variant_id,
    slug: row.slug,
    name: row.name,
    options: row.options,
    optionsLabel: optionsLabel(row.options),
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

// Which variant does the customer want? With variantId: that one (it must belong to the
// product). Without: fine for a product that has only one variant; otherwise they must choose.
export const resolveVariant = async (productId, variantId) => {
  const { rows } = await pool.query(
    `SELECT v.id, v.product_id, v.options, v.price, v.stock, p.name
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.product_id = $1
     ORDER BY v.price, v.created_at`,
    [productId]
  );

  if (rows.length === 0) {
    throw new AppError(404, "Product not found");
  }
  if (variantId !== undefined) {
    const chosen = rows.find((v) => v.id === variantId);
    if (!chosen) {
      throw new AppError(404, "This product has no such variant");
    }
    return chosen;
  }
  if (rows.length > 1) {
    throw new AppError(400, "Validation failed", [{
      field: "variantId",
      message: `This product comes in ${rows.length} options (${rows.map((v) => optionsLabel(v.options)).join(" / ")}): send the variantId of the one you want`
    }]);
  }
  return rows[0];
};

// The cart line a URL points at. Accepts a variant id, or a product id when the customer has
// only one variant of that product in their cart (so older apps that send product ids still work).
export const findCartLine = async (userId, id) => {
  const { rows } = await pool.query(
    `SELECT ci.variant_id, ci.quantity, v.stock, v.options, p.name
     FROM cart_items ci
     JOIN product_variants v ON v.id = ci.variant_id
     JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = $1 AND (ci.variant_id = $2 OR ci.product_id = $2)`,
    [userId, id]
  );
  if (rows.length > 1) {
    throw new AppError(409, "Your cart has several options of this product: use the variant id");
  }
  return rows[0];
};

// How many of this variant are already in the user's cart (0 if none)
export const getCartItemQuantity = async (userId, variantId) => {
  const { rows } = await pool.query(
    "SELECT quantity FROM cart_items WHERE user_id = $1 AND variant_id = $2",
    [userId, variantId]
  );
  return rows[0]?.quantity ?? 0;
};

// "Upsert": insert a new row, or if this variant is already in the cart, add to its quantity.
// One statement, so two quick clicks on "Add to cart" can't lose an update.
export const addCartItem = async (userId, productId, variantId, quantity) => {
  await pool.query(
    `INSERT INTO cart_items (user_id, product_id, variant_id, quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, variant_id)
     DO UPDATE SET
       quantity = cart_items.quantity + EXCLUDED.quantity,
       updated_at = NOW()`,
    [userId, productId, variantId, quantity]
  );
};

export const setCartItemQuantity = async (userId, variantId, quantity) => {
  await pool.query(
    `UPDATE cart_items
     SET quantity = $3, updated_at = NOW()
     WHERE user_id = $1 AND variant_id = $2`,
    [userId, variantId, quantity]
  );
};

export const removeCartItem = async (userId, variantId) => {
  await pool.query(
    "DELETE FROM cart_items WHERE user_id = $1 AND variant_id = $2",
    [userId, variantId]
  );
};

export const clearCart = async (userId) => {
  await pool.query("DELETE FROM cart_items WHERE user_id = $1", [userId]);
};
