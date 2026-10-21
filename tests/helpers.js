// Shared building blocks for the tests: a client for the app, a clean database,
// and quick ways to create users, products, addresses and orders.
import crypto from "node:crypto";
import request from "supertest";
import app from "../src/app.js";
import pool from "../src/config/db.js";
import { slugify } from "../src/utils/slugify.js";

// Sends requests straight to the Express app, no real server or port needed:
//   const res = await api().get("/products");
export const api = () => request(app);

export { pool };

// Empties every table (except the migration history) and restarts ids at 1,
// so each test starts from the same known state
export const resetDatabase = async () => {
  const { rows: [{ db }] } = await pool.query("SELECT current_database() AS db");
  if (!db.endsWith("_test")) {
    throw new Error(`resetDatabase refused to run on "${db}"`);
  }

  const { rows } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'"
  );
  await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
};

export const closeDatabase = () => pool.end();

// Opens the pool's connections before a "many requests at once" test, like on a running server.
// Opening a new connection takes a few ms, which would spread the requests out so they
// barely overlap, and a race-condition test could then pass even with the bug present.
export const warmUpPool = () =>
  Promise.all(Array.from({ length: 10 }, () => pool.query("SELECT pg_sleep(0.05)")));

let counter = 0;
const unique = () => `${Date.now().toString(36)}${++counter}`;

// Registers a user through the real API and logs them in. Returns { id, email, token, auth }
export const createUser = async ({ role = "user", name = "Test User", password = "secret123" } = {}) => {
  const email = `user-${unique()}@example.com`;

  const res = await api().post("/auth/register").send({ name, email, password }).expect(201);
  const id = res.body.data.user.id;

  if (role === "admin") {
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [id]);
  }

  const token = res.body.data.token;
  return { id, email, password, token, auth: { Authorization: `Bearer ${token}` } };
};

// Inserts a product directly (faster than going through the admin API), with its one
// default variant. Returns the product plus variantId.
export const createProduct = async ({ name = "Test Product", price = 100, stock = 10, categoryId = null } = {}) => {
  const { rows: [product] } = await pool.query(
    `INSERT INTO products (slug, name, price, stock, category_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, slug, name, price, stock`,
    [`${slugify(name)}-${unique()}`, name, price, stock, categoryId]
  );
  const { rows: [variant] } = await pool.query(
    "INSERT INTO product_variants (product_id, price, stock) VALUES ($1, $2, $3) RETURNING id",
    [product.id, price, stock]
  );
  return { ...product, variantId: variant.id };
};

// Changes stock or price the way it really lives now: on the product's variant(s)
export const setVariantFields = (productId, { stock, price }) =>
  pool.query(
    "UPDATE product_variants SET stock = COALESCE($2, stock), price = COALESCE($3, price) WHERE product_id = $1",
    [productId, stock ?? null, price ?? null]
  );

export const createAddress = async (user, fields = {}) => {
  const res = await api()
    .post("/addresses")
    .set(user.auth)
    .send({
      fullName: "Test User",
      phone: "+91 98765 43210",
      line1: "1 Test Street",
      city: "Pune",
      state: "Maharashtra",
      postalCode: "411001",
      ...fields
    })
    .expect(201);
  return res.body.data;
};

// Puts items in the user's cart and checks out. items: [[productId, quantity], ...]
export const placeOrder = async (user, items) => {
  for (const [productId, quantity] of items) {
    await api().post("/cart/items").set(user.auth).send({ productId, quantity }).expect(200);
  }
  return api().post("/orders").set(user.auth).send({});
};

export const setOrderStatus = (orderId, status) =>
  pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, orderId]);

export const stockOf = async (productId) =>
  (await pool.query("SELECT stock FROM products WHERE id = $1", [productId])).rows[0].stock;

// Signs data the way Razorpay does
export const hmac = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("hex");
