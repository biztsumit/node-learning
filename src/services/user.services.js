import pool from "../config/db.js";
import { queryWithContext, withTransaction } from "../db/transaction.ts";
import { AppError } from "../utils/app-error.ts";

export const findUserByEmail = async (email) => {
  const { rows } = await pool.query(
    "SELECT id, name, email, role, password_hash, token_version FROM users WHERE email = $1",
    [email]
  );
  return rows[0];
};

export const findUserById = async (id) => {
  const { rows } = await pool.query(
    "SELECT id, name, email, role, created_at, email_verified_at IS NOT NULL AS email_verified FROM users WHERE id = $1",
    [id]
  );
  return rows[0];
};

// What requireAuth needs to check a token on every request
export const getAuthState = async (id) => {
  const { rows } = await pool.query(
    "SELECT role, token_version FROM users WHERE id = $1",
    [id]
  );
  return rows[0];
};

export const getPasswordHash = async (id) => {
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [id]);
  return rows[0]?.password_hash;
};

export const createUser = async ({ name, email, passwordHash }) => {
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, role, created_at`,
    [name, email, passwordHash]
  );
  return rows[0];
};

export const updateUserName = async (id, name) => {
  const { rows } = await queryWithContext(
    `UPDATE users SET name = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, name, email, role, created_at`,
    [name, id]
  );
  return rows[0];
};

// Saves the new password AND raises token_version, so every token issued before now stops working
export const updatePassword = async (id, passwordHash) => {
  const { rows } = await queryWithContext(
    `UPDATE users
     SET password_hash = $1, token_version = token_version + 1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, role, token_version`,
    [passwordHash, id]
  );
  return rows[0];
};

// "Log out everywhere": invalidates every token without changing the password
export const bumpTokenVersion = async (id) => {
  const { rows } = await pool.query(
    `UPDATE users SET token_version = token_version + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING id, role, token_version`,
    [id]
  );
  return rows[0];
};

export const updateUserRole = async (email, role) => {
  const { rows } = await queryWithContext(
    "UPDATE users SET role = $1, updated_at = NOW() WHERE email = $2 RETURNING id, name, email, role",
    [role, email]
  );
  return rows[0];
};

export const getAllUsers = async () => {
  const { rows } = await pool.query(
    "SELECT id, name, email, role, created_at FROM users ORDER BY id"
  );
  return rows;
};

// PATCH /users/:id/role. Two rules keep the shop manageable:
//   - nobody changes their OWN role (an admin can't lock themselves out by accident)
//   - there's always at least one admin left
// Two admins demoting each other at the same moment could otherwise BOTH succeed and leave
// none. So every admin row is locked first (FOR UPDATE): the second request waits, then
// counts again and sees it would remove the last admin.
export const changeUserRole = (actorId, userId, role) =>
  withTransaction(async (client) => {
    if (actorId === userId) {
      throw new AppError(409, "You can't change your own role. Ask another admin");
    }
    const { rows: admins } = await client.query(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY id FOR UPDATE"
    );
    const { rows: [user] } = await client.query(
      "SELECT id, role FROM users WHERE id = $1 FOR UPDATE",
      [userId]
    );
    if (!user) {
      throw new AppError(404, "User not found");
    }
    if (user.role === "admin" && role !== "admin" && admins.length <= 1) {
      throw new AppError(409, "This is the last admin: make someone else an admin first");
    }
    const { rows } = await client.query(
      "UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, role, created_at",
      [role, userId]
    );
    return rows[0];
  });
