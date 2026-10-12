import pool from "../config/db.js";

export const findUserByEmail = async (email) => {
  const { rows } = await pool.query(
    "SELECT id, name, email, role, password_hash FROM users WHERE email = $1",
    [email]
  );
  return rows[0];
};

export const findUserById = async (id) => {
  const { rows } = await pool.query(
    "SELECT id, name, email, role, created_at FROM users WHERE id = $1",
    [id]
  );
  return rows[0];
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

export const updateUserRole = async (email, role) => {
  const { rows } = await pool.query(
    "UPDATE users SET role = $1 WHERE email = $2 RETURNING id, name, email, role",
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
