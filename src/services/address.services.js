import pool from "../config/db.js";
import { withTransaction } from "../db/transaction.js";
import { AppError } from "../utils/app-error.js";
import { postalCodeProblem } from "../validators/address.validators.js";

const ADDRESS_COLUMNS = `
  id, label, full_name, phone, line1, line2, city, state, postal_code, country, is_default
`;

export const toAddress = (row) => ({
  id: row.id,
  label: row.label,
  fullName: row.full_name,
  phone: row.phone,
  line1: row.line1,
  line2: row.line2,
  city: row.city,
  state: row.state,
  postalCode: row.postal_code,
  country: row.country,
  isDefault: row.is_default
});

// API field name → database column. Also the list of fields PATCH is allowed to change.
const COLUMN_FOR_FIELD = {
  label: "label",
  fullName: "full_name",
  phone: "phone",
  line1: "line1",
  line2: "line2",
  city: "city",
  state: "state",
  postalCode: "postal_code",
  country: "country"
};

// Every function takes the userId from the token, so users only ever see their own addresses

export const listAddresses = async (userId) => {
  const { rows } = await pool.query(
    `SELECT ${ADDRESS_COLUMNS} FROM addresses
     WHERE user_id = $1
     ORDER BY is_default DESC, created_at DESC, id DESC`,
    [userId]
  );
  return rows.map(toAddress);
};

export const getAddress = async (userId, addressId, db = pool) => {
  const { rows } = await db.query(
    `SELECT ${ADDRESS_COLUMNS} FROM addresses WHERE id = $1 AND user_id = $2`,
    [addressId, userId]
  );
  return rows[0] && toAddress(rows[0]);
};

// Only one default per user: clear the old default before setting a new one
const clearDefault = (client, userId) =>
  client.query("UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default", [userId]);

export const createAddress = async (userId, address) => {
  return withTransaction(async (client) => {

    // Lock this user's row so two "add address" requests at once can't both become the default
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);

    const { rows: [{ count }] } = await client.query(
      "SELECT COUNT(*)::int AS count FROM addresses WHERE user_id = $1",
      [userId]
    );

    // Your first address is always your default
    const isDefault = address.isDefault || count === 0;

    if (isDefault) {
      await clearDefault(client, userId);
    }

    const { rows } = await client.query(
      `INSERT INTO addresses
         (user_id, label, full_name, phone, line1, line2, city, state, postal_code, country, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${ADDRESS_COLUMNS}`,
      [
        userId, address.label ?? null, address.fullName, address.phone, address.line1, address.line2 ?? null,
        address.city, address.state, address.postalCode, address.country, isDefault
      ]
    );
    return toAddress(rows[0]);
  });
};

// Partial update: only the fields that were sent are changed
export const updateAddress = async (userId, addressId, fields) => {
  return withTransaction(async (client) => {

    const { rows: [current] } = await client.query(
      "SELECT country, postal_code FROM addresses WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [addressId, userId]
    );

    if (!current) {
      return undefined;
    }

    // Check the PIN code against the address as it will be AFTER this change,
    // e.g. a PATCH of only { postalCode } must still match the saved country
    const problem = postalCodeProblem(
      fields.country ?? current.country,
      fields.postalCode ?? current.postal_code
    );
    if (problem) {
      throw new AppError(400, "Validation failed", [{ field: "postalCode", message: problem }]);
    }

    if (fields.isDefault === true) {
      await clearDefault(client, userId);
    }

    // Build "SET full_name = $3, city = $4, ..." from the sent fields.
    // Column names come from COLUMN_FOR_FIELD (our own list), values go in as $n placeholders.
    const values = [addressId, userId];
    const sets = ["updated_at = NOW()"];

    for (const [field, column] of Object.entries(COLUMN_FOR_FIELD)) {
      if (fields[field] !== undefined) {
        values.push(fields[field]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (fields.isDefault !== undefined) {
      values.push(fields.isDefault);
      sets.push(`is_default = $${values.length}`);
    }

    const { rows } = await client.query(
      `UPDATE addresses SET ${sets.join(", ")}
       WHERE id = $1 AND user_id = $2
       RETURNING ${ADDRESS_COLUMNS}`,
      values
    );
    return toAddress(rows[0]);
  });
};

// If the default address is deleted, the newest remaining address becomes the default
export const deleteAddress = async (userId, addressId) => {
  return withTransaction(async (client) => {

    const { rows: [deleted] } = await client.query(
      "DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING is_default",
      [addressId, userId]
    );

    if (!deleted) {
      return false;
    }

    if (deleted.is_default) {
      await client.query(
        `UPDATE addresses SET is_default = true
         WHERE id = (
           SELECT id FROM addresses WHERE user_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT 1
         )`,
        [userId]
      );
    }

    return true;
  });
};
