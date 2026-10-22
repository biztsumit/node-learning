import type { NextFunction, Response } from "express";
import type { AnyRequest } from "../types/http.ts";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.ts";
import { getAuthState } from "../services/user.services.ts";
import { AppError } from "../utils/app-error.ts";
import { idSchema } from "../validators/common.validators.ts";
import { setActor } from "../context/request-context.ts";
import type { AuthUser, Role } from "../types/express.d.ts";

// What we put in our tokens. TypeScript types disappear when the code runs, so data from
// OUTSIDE (a token, a request body) is checked at run time with zod, and z.infer gives
// TypeScript the matching type: one definition, checked both ways.
//
// Tokens issued before ids became UUIDs carry a number: they fail here like any other ended
// session (looking a number up in a uuid column would be a database error, a 500).
const tokenPayloadSchema = z.object({
  userId: idSchema("userId"),
  tokenVersion: z.number().int()
});

type TokenPayload = z.infer<typeof tokenPayloadSchema>;

const readToken = (token: string): TokenPayload => {
  let decoded: unknown;

  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw new AppError(401, "Invalid or expired token");
  }

  const parsed = tokenPayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new AppError(401, "Your session has ended. Please log in again");
  }
  return parsed.data;
};

export const requireAuth = async (req: AnyRequest, res: Response, next: NextFunction): Promise<void> => {

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError(401, "Login required");
  }

  const payload = readToken(authHeader.slice("Bearer ".length));

  // The signature proves WE issued this token. The database tells us if it's still valid:
  // the user may have been deleted, changed their password, or logged out everywhere since.
  const user: { role: Role; token_version: number } | undefined = await getAuthState(payload.userId);

  if (!user || payload.tokenVersion !== user.token_version) {
    throw new AppError(401, "Your session has ended. Please log in again");
  }

  // The role comes from the database, so a promotion or demotion takes effect immediately
  req.user = { id: payload.userId, role: user.role };
  // Changes made during this request are recorded as made by this user
  setActor(req.user.id);
  next();
};

// The logged-in user, in a controller behind requireAuth. req.user is optional in Express's
// types (public routes have nobody logged in), so this checks it's really there: if a route
// were ever wired up without requireAuth, the request fails with 401 instead of crashing.
// It only needs the user, so it accepts any request that may carry one.
export const currentUser = (req: { user?: AuthUser }): AuthUser => {
  if (!req.user) {
    throw new AppError(401, "Login required");
  }
  return req.user;
};

// Use after requireAuth, which sets req.user
export const requireAdmin = (req: AnyRequest, res: Response, next: NextFunction): void => {

  if (req.user?.role !== "admin") {
    throw new AppError(403, "Admin access required");
  }

  next();
};
