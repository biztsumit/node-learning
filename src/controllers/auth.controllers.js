import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import * as userService from "../services/user.services.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/app-error.js";
import { PG_UNIQUE_VIOLATION } from "../utils/db-errors.js";

// The role is not put in the token any more: requireAuth reads it fresh from the database.
// tokenVersion must match users.token_version, or the token is refused.
const createToken = (user) => {
  return jwt.sign(
    { userId: user.id, tokenVersion: user.token_version ?? 0 },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
};

export const register = async (req, res) => {

  const { name, email, password } = req.body;

  const passwordHash = await bcrypt.hash(password, 10);

  let user;

  try {
    user = await userService.createUser({ name, email, passwordHash });
  } catch (err) {
    // The UNIQUE rule on users.email rejected it: someone already has this email
    if (err.code === PG_UNIQUE_VIOLATION) {
      throw new AppError(409, "Email is already registered");
    }
    throw err;
  }

  res.status(201).json({
    success: true,
    data: {
      user,
      token: createToken(user)
    }
  });
};

export const login = async (req, res) => {

  const { email, password } = req.body;

  const user = await userService.findUserByEmail(email);

  const passwordMatches = user && await bcrypt.compare(password, user.password_hash);

  if (!passwordMatches) {
    throw new AppError(401, "Invalid email or password");
  }

  res.json({
    success: true,
    data: {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token: createToken(user)
    }
  });
};

export const getMe = async (req, res) => {

  const user = await userService.findUserById(req.user.id);

  if (!user) {
    throw new AppError(404, "User not found");
  }

  res.json({
    success: true,
    data: user
  });
};

// PATCH /auth/me  { name }
export const updateMe = async (req, res) => {

  const user = await userService.updateUserName(req.user.id, req.body.name);

  res.json({
    success: true,
    data: user
  });
};

// POST /auth/change-password  { currentPassword, newPassword }
export const changePassword = async (req, res) => {

  const { currentPassword, newPassword } = req.body;

  // Ask for the current password again: a stolen token alone can't take over the account
  const currentHash = await userService.getPasswordHash(req.user.id);
  const correct = await bcrypt.compare(currentPassword, currentHash);

  if (!correct) {
    throw new AppError(400, "Validation failed", [
      { field: "currentPassword", message: "currentPassword is incorrect" }
    ]);
  }

  const newHash = await bcrypt.hash(newPassword, 10);

  // This also logs out every device, including this one...
  const user = await userService.updatePassword(req.user.id, newHash);

  res.json({
    success: true,
    message: "Password changed. You've been logged out on all other devices",
    // ...so send this device a fresh token to stay logged in
    data: { token: createToken(user) }
  });
};

// POST /auth/logout-all — e.g. "I lost my phone"
export const logoutAll = async (req, res) => {

  await userService.bumpTokenVersion(req.user.id);

  res.json({
    success: true,
    message: "Logged out on all devices"
  });
};
