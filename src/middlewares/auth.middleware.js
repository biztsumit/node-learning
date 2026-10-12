import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../utils/app-error.js";

export const requireAuth = (req, res, next) => {

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError(401, "Login required");
  }

  const token = authHeader.split(" ")[1];

  let payload;

  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw new AppError(401, "Invalid or expired token");
  }

  req.user = { id: payload.userId, role: payload.role };
  next();
};

// Use after requireAuth, which sets req.user
export const requireAdmin = (req, res, next) => {

  if (req.user.role !== "admin") {
    throw new AppError(403, "Admin access required");
  }

  next();
};
