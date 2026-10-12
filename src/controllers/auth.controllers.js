import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import * as userService from "../services/user.services.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/app-error.js";
import { PG_UNIQUE_VIOLATION } from "../utils/db-errors.js";

const createToken = (user) => {
  return jwt.sign(
    { userId: user.id, role: user.role },
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
