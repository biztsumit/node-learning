// Product variants: the actual things you buy ("T-Shirt, size M, blue"), each with its own
// price and stock. Every product has at least one; a simple product has one with no options.
import type { Pool, PoolClient } from "pg";
import pool from "../config/db.js";
import { withTransaction } from "../db/transaction.ts";
import { AppError } from "../utils/app-error.ts";
import { PG_UNIQUE_VIOLATION, isDatabaseError } from "../utils/db-errors.ts";
import { setStockContext } from "../db/stock-context.ts";
import type { CreateVariant, UpdateVariant } from "../validators/variant.validators.ts";

// {"size": "M", "colour": "Blue"}: option name → chosen value
export type VariantOptions = Record<string, string>;

type VariantRow = {
  id: string;
  options: VariantOptions;
  sku: string | null;
  price: number;
  stock: number;
};

export type Variant = VariantRow & {
  label: string;
};

// {"size": "M", "colour": "Blue"} → "Size: M, Colour: Blue"   ({} → "")
export const optionsLabel = (options: VariantOptions = {}): string =>
  Object.entries(options)
    .map(([name, value]) => `${name.charAt(0).toUpperCase()}${name.slice(1)}: ${value}`)
    .join(", ");

const toVariant = (row: VariantRow): Variant => ({
  id: row.id,
  options: row.options,
  label: optionsLabel(row.options),
  sku: row.sku,
  price: row.price,
  stock: row.stock
});

const VARIANT_COLUMNS = "id, options, sku, price, stock";

// db: the pool, or a transaction's client when called inside one
export const listVariants = async (productId: string, db: Pool | PoolClient = pool): Promise<Variant[]> => {
  const { rows } = await db.query<VariantRow>(
    `SELECT ${VARIANT_COLUMNS} FROM product_variants WHERE product_id = $1 ORDER BY price, created_at, id`,
    [productId]
  );
  return rows.map(toVariant);
};

const sameKeys = (a: VariantOptions, b: VariantOptions): boolean =>
  JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort());

// Every variant change for a product locks the product row first, so two admins editing
// variants of the same product at once take turns (and the rules below can't be raced past)
const lockProduct = async (client: PoolClient, productId: string): Promise<void> => {
  const { rows } = await client.query("SELECT id FROM products WHERE id = $1 FOR UPDATE", [productId]);
  if (rows.length === 0) {
    throw new AppError(404, "Product not found");
  }
};

// All variants of a product must use the same option names: if some are "size + colour",
// a variant with only "size" would make no sense to choose in a shop.
const checkOptionNames = (others: Variant[], options: VariantOptions): void => {
  const mismatch = others.find((v) => !sameKeys(v.options, options));
  if (mismatch) {
    const expected = Object.keys(mismatch.options);
    throw new AppError(409, expected.length > 0
      ? `Every variant of this product must have the options: ${expected.join(", ")}`
      : "This product's existing variant has no options. Give it options first (PATCH it), then add more variants");
  }
};

// ": never" = this function never returns normally: it always throws
const handleDbError = (err: unknown): never => {
  if (isDatabaseError(err) && err.code === PG_UNIQUE_VIOLATION && err.constraint === "product_variants_product_options_key") {
    throw new AppError(409, "This product already has a variant with exactly these options");
  }
  if (isDatabaseError(err) && err.code === PG_UNIQUE_VIOLATION && err.constraint === "product_variants_sku_key") {
    throw new AppError(409, "Another variant already uses this SKU");
  }
  throw err;
};

// An UPDATE/INSERT ... RETURNING on a row we've just locked always returns it
const returnedVariant = (rows: VariantRow[]): Variant => {
  const [row] = rows;
  if (!row) {
    throw new AppError(404, "Variant not found");
  }
  return toVariant(row);
};

// adminId: who did it, for the stock ledger
export const createVariant = (productId: string, { options, sku, price, stock }: CreateVariant, adminId: string): Promise<Variant> =>
  withTransaction(async (client) => {
    await lockProduct(client, productId);
    await setStockContext(client, { reason: "initial", userId: adminId });
    checkOptionNames(await listVariants(productId, client), options);

    const { rows } = await client
      .query<VariantRow>(
        `INSERT INTO product_variants (product_id, options, sku, price, stock)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${VARIANT_COLUMNS}`,
        [productId, options, sku ?? null, price, stock]
      )
      .catch(handleDbError);
    return returnedVariant(rows);
  });

// Partial update: send only what changes
// Setting stock here is a "correction" in the ledger (for deliveries, use a stock movement)
export const updateVariant = (productId: string, variantId: string, fields: UpdateVariant, adminId: string): Promise<Variant> =>
  withTransaction(async (client) => {
    await lockProduct(client, productId);
    await setStockContext(client, { reason: "correction", userId: adminId });
    const variants = await listVariants(productId, client);
    const current = variants.find((v) => v.id === variantId);
    if (!current) {
      throw new AppError(404, "Variant not found");
    }
    if (fields.options !== undefined) {
      checkOptionNames(variants.filter((v) => v.id !== variantId), fields.options);
    }

    const { rows } = await client
      .query<VariantRow>(
        `UPDATE product_variants
         SET options = COALESCE($3, options),
             sku = CASE WHEN $4::boolean THEN $5 ELSE sku END,
             price = COALESCE($6, price),
             stock = COALESCE($7, stock)
         WHERE id = $1 AND product_id = $2
         RETURNING ${VARIANT_COLUMNS}`,
        [variantId, productId, fields.options ?? null, fields.sku !== undefined, fields.sku ?? null, fields.price ?? null, fields.stock ?? null]
      )
      .catch(handleDbError);
    return returnedVariant(rows);
  });

export const deleteVariant = (productId: string, variantId: string): Promise<void> =>
  withTransaction(async (client) => {
    await lockProduct(client, productId);
    const variants = await listVariants(productId, client);
    if (!variants.some((v) => v.id === variantId)) {
      throw new AppError(404, "Variant not found");
    }
    if (variants.length === 1) {
      throw new AppError(409, "A product needs at least one variant. Delete the product instead");
    }
    // Carts holding it lose that line (ON DELETE CASCADE); past orders keep their snapshot
    await client.query("DELETE FROM product_variants WHERE id = $1", [variantId]);
  });
