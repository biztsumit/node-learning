import type { NextFunction, Response } from "express";
import { paymentsEnabled } from "../config/env.ts";
import type { AnyRequest } from "../types/http.ts";
import { AppError } from "../utils/app-error.ts";

// Payment routes answer 503 until the Razorpay keys are set in .env
export const requirePaymentsEnabled = (req: AnyRequest, res: Response, next: NextFunction): void => {
  if (!paymentsEnabled) {
    throw new AppError(503, "Payments are not configured on this server");
  }
  next();
};
