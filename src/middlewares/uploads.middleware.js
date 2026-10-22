import { uploadsEnabled } from "../config/env.ts";
import { AppError } from "../utils/app-error.ts";

// Image upload routes answer 503 until the Cloudinary keys are set in .env
export const requireUploadsEnabled = (req, res, next) => {
  if (!uploadsEnabled) {
    throw new AppError(503, "Image uploads are not configured on this server");
  }
  next();
};
