import { paymentsEnabled } from "../config/env.js";
import { AppError } from "../utils/app-error.js";

// Payment routes answer 503 until the Razorpay keys are set in .env
export const requirePaymentsEnabled = (req, res, next) => {
  if (!paymentsEnabled) {
    throw new AppError(503, "Payments are not configured on this server");
  }
  next();
};
