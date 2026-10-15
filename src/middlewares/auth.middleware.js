import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { getAuthState } from "../services/user.services.js";
import { AppError } from "../utils/app-error.js";

export const requireAuth = async (req, res, next) => {

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

  // The signature proves WE issued this token. The database tells us if it's still valid:
  // the user may have been deleted, changed their password, or logged out everywhere since.
  const user = await getAuthState(payload.userId);

  if (!user || payload.tokenVersion !== user.token_version) {
    throw new AppError(401, "Your session has ended. Please log in again");
  }

  // The role comes from the database, so a promotion or demotion takes effect immediately
  req.user = { id: payload.userId, role: user.role };
  next();
};

// Use after requireAuth, which sets req.user
export const requireAdmin = (req, res, next) => {

  if (req.user.role !== "admin") {
    throw new AppError(403, "Admin access required");
  }

  next();
};
