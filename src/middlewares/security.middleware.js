import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { AppError } from "../utils/app-error.js";

// ---------- Safe HTTP headers ----------

// Adds headers that tell browsers to be stricter: no sniffing file types, no showing
// our responses inside other sites' frames, HTTPS only, etc. Also hides "X-Powered-By: Express".
export const securityHeaders = helmet();

// ---------- CORS ----------

// Browsers block a web page from reading responses from a DIFFERENT site unless that site
// says it's allowed. This decides which websites (origins) may call our API from a browser.
export const corsPolicy = cors({
  origin: (origin, callback) => {
    // No Origin header: not a browser page (Postman, curl, mobile apps, Razorpay). CORS doesn't apply.
    if (!origin) {
      return callback(null, true);
    }
    // true = send the "allowed" headers; false = send none, and the browser blocks the page
    callback(null, env.CORS_ORIGINS.includes(origin));
  },
  // Let browser code read these response headers (e.g. to show "try again in 30s",
  // know a response was a replay, or quote the request id in a bug report)
  exposedHeaders: ["RateLimit", "RateLimit-Policy", "Retry-After", "Idempotency-Replayed", "X-Request-Id"]
});

// ---------- Rate limits ----------

// All limiters reply in our usual JSON error format
const limiter = ({ windowMs, limit, message, ...options }) =>
  rateLimit({
    windowMs,
    limit,
    // Send the standard "RateLimit" and "Retry-After" headers
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, message)),
    ...options
  });

// Every route: stops one client from flooding the server
export const apiLimiter = limiter({
  windowMs: 60 * 1000,
  limit: env.API_RATE_LIMIT,
  message: "Too many requests. Please slow down",
  // Razorpay's webhooks are signed and must never be dropped
  skip: (req) => req.originalUrl.startsWith("/webhooks/")
});

// Login and change-password: only FAILED attempts count, so real users are never blocked,
// but someone guessing passwords gets stopped after a few tries
export const failedLoginLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: env.LOGIN_RATE_LIMIT,
  message: "Too many failed attempts. Please try again in 15 minutes",
  skipSuccessfulRequests: true
});

// "Forgot password" / "resend verification": each one sends an email. Without a limit,
// anyone could flood someone's inbox, or burn through the daily email quota.
export const emailLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: env.EMAIL_RATE_LIMIT,
  message: "Too many emails requested. Please try again later"
});

// Sign-ups: stops scripts from creating thousands of fake accounts
export const signupLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: env.SIGNUP_RATE_LIMIT,
  message: "Too many accounts created from this network. Please try again later"
});
