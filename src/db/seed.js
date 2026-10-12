// Usage: npm run seed
// Adds sample data so a fresh database has something to work with.
import pool from "../config/db.js";

const categories = ["Clothing", "Footwear"];

const products = [
  { name: "T-Shirt", price: 999, category: "Clothing" },
  { name: "Shoes", price: 2999, category: "Footwear" }
];

const seed = async () => {

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM products");

  if (rows[0].count > 0) {
    console.log("Products already exist, skipping seed");
    return;
  }

  // Remember each category's new id so products can point at it
  const categoryIds = {};

  for (const name of categories) {
    const { rows } = await pool.query(
      "INSERT INTO categories (name) VALUES ($1) RETURNING id",
      [name]
    );
    categoryIds[name] = rows[0].id;
  }

  for (const product of products) {
    await pool.query(
      "INSERT INTO products (name, price, category_id) VALUES ($1, $2, $3)",
      [product.name, product.price, categoryIds[product.category]]
    );
  }

  console.log(`Seeded ${categories.length} categories and ${products.length} products`);
};

try {
  await seed();
} catch (err) {
  console.error("Seed failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
