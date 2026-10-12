// Usage: npm run seed
// Adds sample data so a fresh database has something to work with.
import pool from "../config/db.js";

const products = [
  { name: "T-Shirt", price: 999 },
  { name: "Shoes", price: 2999 }
];

const seed = async () => {

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM products");

  if (rows[0].count > 0) {
    console.log("Products already exist, skipping seed");
    return;
  }

  for (const product of products) {
    await pool.query(
      "INSERT INTO products (name, price) VALUES ($1, $2)",
      [product.name, product.price]
    );
  }

  console.log(`Seeded ${products.length} products`);
};

try {
  await seed();
} catch (err) {
  console.error("Seed failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
