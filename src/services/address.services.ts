import type { Pool, PoolClient } from "pg";
import pool from "../config/db.ts";
import { withTransaction } from "../db/transaction.ts";
import { AppError } from "../utils/app-error.ts";
import { postalCodeProblem, type CreateAddress, type UpdateAddress } from "../validators/address.validators.ts";

const ADDRESS_COLUMNS = `
  id, label, full_name, phone, line1, line2, city, state, postal_code, country, is_default
`;

type AddressRow = {
  id: string;
  label: string | null;
  full_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
};

export type Address = {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
};

export const toAddress = (row: AddressRow): Address => ({
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
// "satisfies": TypeScript checks every key is a real field of an address update (a typo like
// "postCode" would be an error), while keeping the exact keys for the loop below.
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
} satisfies Partial<Record<keyof UpdateAddress, string>>;

type PatchableField = keyof typeof COLUMN_FOR_FIELD;

// The one row an INSERT/UPDATE ... RETURNING gives back
const returnedAddress = (rows: AddressRow[]): Address => {
  const [row] = rows;
  if (!row) {
    throw new Error("Expected the address row to be returned");
  }
  return toAddress(row);
};

// Every function takes the userId from the token, so users only ever see their own addresses

export const listAddresses = async (userId: string): Promise<Address[]> => {
  const { rows } = await pool.query<AddressRow>(
    `SELECT ${ADDRESS_COLUMNS} FROM addresses
     WHERE user_id = $1
     ORDER BY is_default DESC, created_at DESC, id DESC`,
    [userId]
  );
  return rows.map(toAddress);
};

// db: the pool, or a transaction's client (checkout reads the address inside its transaction)
export const getAddress = async (userId: string, addressId: string, db: Pool | PoolClient = pool): Promise<Address | undefined> => {
  const { rows } = await db.query<AddressRow>(
    `SELECT ${ADDRESS_COLUMNS} FROM addresses WHERE id = $1 AND user_id = $2`,
    [addressId, userId]
  );
  return rows[0] && toAddress(rows[0]);
};

// Only one default per user: clear the old default before setting a new one
const clearDefault = (client: PoolClient, userId: string) =>
  client.query("UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default", [userId]);

export const createAddress = async (userId: string, address: CreateAddress): Promise<Address> => {
  return withTransaction(async (client) => {

    // Lock this user's row so two "add address" requests at once can't both become the default
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);

    const { rows: counted } = await client.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM addresses WHERE user_id = $1",
      [userId]
    );

    // Your first address is always your default
    const isDefault = address.isDefault || (counted[0]?.count ?? 0) === 0;

    if (isDefault) {
      await clearDefault(client, userId);
    }

    const { rows } = await client.query<AddressRow>(
      `INSERT INTO addresses
         (user_id, label, full_name, phone, line1, line2, city, state, postal_code, country, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${ADDRESS_COLUMNS}`,
      [
        userId, address.label ?? null, address.fullName, address.phone, address.line1, address.line2 ?? null,
        address.city, address.state, address.postalCode, address.country, isDefault
      ]
    );
    return returnedAddress(rows);
  });
};

// Partial update: only the fields that were sent are changed. undefined = no such address.
export const updateAddress = async (userId: string, addressId: string, fields: UpdateAddress): Promise<Address | undefined> => {
  return withTransaction(async (client) => {

    const { rows: [current] } = await client.query<{ country: string; postal_code: string }>(
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
    const values: unknown[] = [addressId, userId];
    const sets = ["updated_at = NOW()"];

    for (const [field, column] of Object.entries(COLUMN_FOR_FIELD) as Array<[PatchableField, string]>) {
      if (fields[field] !== undefined) {
        values.push(fields[field]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (fields.isDefault !== undefined) {
      values.push(fields.isDefault);
      sets.push(`is_default = $${values.length}`);
    }

    const { rows } = await client.query<AddressRow>(
      `UPDATE addresses SET ${sets.join(", ")}
       WHERE id = $1 AND user_id = $2
       RETURNING ${ADDRESS_COLUMNS}`,
      values
    );
    return returnedAddress(rows);
  });
};

// If the default address is deleted, the newest remaining address becomes the default
export const deleteAddress = async (userId: string, addressId: string): Promise<boolean> => {
  return withTransaction(async (client) => {

    const { rows: [deleted] } = await client.query<{ is_default: boolean }>(
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
