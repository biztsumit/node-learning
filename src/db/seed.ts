// Usage: npm run seed
// Adds sample data so a fresh database has something to work with.
import pool from "../config/db.ts";
import { slugify } from "../utils/slugify.ts";
import { errorMessage } from "../utils/app-error.ts";

const categories = ["Clothing", "Footwear"];

const products = [
  {
    name: "T-Shirt",
    description: "Soft cotton t-shirt for everyday wear.",
    price: 999,
    stock: 50,
    category: "Clothing"
  },
  {
    name: "Shoes",
    description: "Lightweight running shoes.",
    price: 2999,
    stock: 20,
    category: "Footwear"
  }
];

// Demo discount codes, one of each kind
const coupons = [
  { code: "WELCOME10", description: "10% off your order, up to ₹500", type: "percent", value: 10, maxDiscount: 500, minOrder: 0 },
  { code: "FLAT200", description: "₹200 off orders of ₹1,500 or more", type: "fixed", value: 200, maxDiscount: null, minOrder: 1500 }
];

// Safe to run again and again: ON CONFLICT skips codes that already exist,
// so databases seeded before coupons existed get them too
const seedCoupons = async () => {
  let added = 0;
  for (const c of coupons) {
    const { rowCount } = await pool.query(
      `INSERT INTO coupons (code, description, discount_type, discount_value, max_discount, min_order_amount)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (code) DO NOTHING`,
      [c.code, c.description, c.type, c.value, c.maxDiscount, c.minOrder]
    );
    added += rowCount ?? 0;
  }
  console.log(`Added ${added} demo coupons`);
};

const seed = async () => {

  await seedCoupons();

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM products");

  if (rows[0].count > 0) {
    console.log("Products already exist, skipping seed");
    return;
  }

  // Remember each category's new id so products can point at it
  const categoryIds: Record<string, string> = {};

  for (const name of categories) {
    const { rows: [category] } = await pool.query<{ id: string }>(
      "INSERT INTO categories (name) VALUES ($1) RETURNING id",
      [name]
    );
    if (category) {
      categoryIds[name] = category.id;
    }
  }

  for (const product of products) {
    const { rows: [created] } = await pool.query<{ id: string }>(
      `INSERT INTO products (slug, name, description, price, stock, category_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        slugify(product.name),
        product.name,
        product.description,
        product.price,
        product.stock,
        categoryIds[product.category]
      ]
    );
    if (!created) {
      throw new Error(`Could not create ${product.name}`);
    }
    // Every product needs at least one variant: price and stock really live there
    await pool.query(
      "INSERT INTO product_variants (product_id, price, stock) VALUES ($1, $2, $3)",
      [created.id, product.price, product.stock]
    );
  }

  console.log(`Seeded ${categories.length} categories and ${products.length} products`);
};

try {
  await seed();
} catch (err) {
  console.error("Seed failed:", errorMessage(err));
  process.exitCode = 1;
} finally {
  await pool.end();
}
