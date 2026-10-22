import pool from "../config/db.js";
import { queryWithContext, withTransaction } from "../db/transaction.ts";
import { AppError } from "../utils/app-error.ts";
import type { Role } from "../types/express.d.ts";

// What's safe to send to the user (or an admin): never the password hash or token version
export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: Date;
};

// Only for logging in: includes the secrets needed to check a password and issue a token.
// A separate type makes it visible which functions handle the hash.
export type UserWithSecrets = Omit<PublicUser, "created_at"> & {
  password_hash: string;
  token_version: number;
};

// After a password or token change: what's needed to issue a fresh token
type TokenState = { id: string; role: Role; token_version: number };

export const findUserByEmail = async (email: string): Promise<UserWithSecrets | undefined> => {
  const { rows } = await pool.query<UserWithSecrets>(
    "SELECT id, name, email, role, password_hash, token_version FROM users WHERE email = $1",
    [email]
  );
  return rows[0];
};

export const findUserById = async (id: string): Promise<(PublicUser & { email_verified: boolean }) | undefined> => {
  const { rows } = await pool.query<PublicUser & { email_verified: boolean }>(
    "SELECT id, name, email, role, created_at, email_verified_at IS NOT NULL AS email_verified FROM users WHERE id = $1",
    [id]
  );
  return rows[0];
};

// What requireAuth needs to check a token on every request
export const getAuthState = async (id: string): Promise<{ role: Role; token_version: number } | undefined> => {
  const { rows } = await pool.query<{ role: Role; token_version: number }>(
    "SELECT role, token_version FROM users WHERE id = $1",
    [id]
  );
  return rows[0];
};

export const getPasswordHash = async (id: string): Promise<string | undefined> => {
  const { rows } = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [id]);
  return rows[0]?.password_hash;
};

// A new account's row always comes back (or the INSERT throws)
const firstRow = <T>(rows: T[]): T => {
  const [row] = rows;
  if (row === undefined) {
    throw new Error("Expected the query to return a row");
  }
  return row;
};

export const createUser = async (
  { name, email, passwordHash }: { name: string; email: string; passwordHash: string }
): Promise<PublicUser> => {
  const { rows } = await pool.query<PublicUser>(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, role, created_at`,
    [name, email, passwordHash]
  );
  return firstRow(rows);
};

export const updateUserName = async (id: string, name: string): Promise<PublicUser | undefined> => {
  const { rows } = await queryWithContext<PublicUser>(
    `UPDATE users SET name = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, name, email, role, created_at`,
    [name, id]
  );
  return rows[0];
};

// Saves the new password AND raises token_version, so every token issued before now stops working
export const updatePassword = async (id: string, passwordHash: string): Promise<TokenState | undefined> => {
  const { rows } = await queryWithContext<TokenState>(
    `UPDATE users
     SET password_hash = $1, token_version = token_version + 1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, role, token_version`,
    [passwordHash, id]
  );
  return rows[0];
};

// "Log out everywhere": invalidates every token without changing the password
export const bumpTokenVersion = async (id: string): Promise<TokenState | undefined> => {
  const { rows } = await pool.query<TokenState>(
    `UPDATE users SET token_version = token_version + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING id, role, token_version`,
    [id]
  );
  return rows[0];
};

// Used by the make-admin script (by email: that's what a person types)
export const updateUserRole = async (email: string, role: Role): Promise<Omit<PublicUser, "created_at"> | undefined> => {
  const { rows } = await queryWithContext<Omit<PublicUser, "created_at">>(
    "UPDATE users SET role = $1, updated_at = NOW() WHERE email = $2 RETURNING id, name, email, role",
    [role, email]
  );
  return rows[0];
};

export const getAllUsers = async (): Promise<PublicUser[]> => {
  const { rows } = await pool.query<PublicUser>(
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
export const changeUserRole = (actorId: string, userId: string, role: Role): Promise<PublicUser> =>
  withTransaction(async (client) => {
    if (actorId === userId) {
      throw new AppError(409, "You can't change your own role. Ask another admin");
    }
    const { rows: admins } = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY id FOR UPDATE"
    );
    const { rows: [user] } = await client.query<{ id: string; role: Role }>(
      "SELECT id, role FROM users WHERE id = $1 FOR UPDATE",
      [userId]
    );
    if (!user) {
      throw new AppError(404, "User not found");
    }
    if (user.role === "admin" && role !== "admin" && admins.length <= 1) {
      throw new AppError(409, "This is the last admin: make someone else an admin first");
    }
    const { rows } = await client.query<PublicUser>(
      "UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, role, created_at",
      [role, userId]
    );
    return firstRow(rows);
  });
