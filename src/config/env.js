// Loads .env and checks every setting the app needs, once, at startup.
// Import `env` from here instead of reading process.env directly.
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().default(3000),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int(),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),

  JWT_SECRET: z.string().min(32, { error: "must be at least 32 characters" }),
  JWT_EXPIRES_IN: z.string().default("1d"),

  // Payments (optional): without these the app runs, but payment routes answer 503
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Websites allowed to call this API from a browser, comma-separated, e.g.
  // "http://localhost:5173,https://shop.example.com". Empty = no browser sites allowed.
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean))
    // An origin is exactly scheme + host (+ port): no path, no trailing slash
    .pipe(z.array(
      z.string().refine(
        (origin) => URL.canParse(origin) && /^https?:$/.test(new URL(origin).protocol) && new URL(origin).origin === origin,
        { error: "each CORS origin must look like http://localhost:5173 (no path, no trailing slash)" }
      )
    )),

  // How many proxies sit in front of this server (ngrok = 1). 0 when clients connect directly.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Rate limits, per client IP
  API_RATE_LIMIT: z.coerce.number().int().min(1).default(120),      // requests per minute
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(10),     // FAILED logins per 15 minutes
  SIGNUP_RATE_LIMIT: z.coerce.number().int().min(1).default(5),     // sign-ups per hour

  // ngrok (optional, development only): with a token, the server also gets a public https URL
  NGROK_AUTHTOKEN: z.string().min(1).optional(),
  NGROK_DOMAIN: z.string().min(1).optional()
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid or missing settings in .env:");
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = result.data;

export const paymentsEnabled = Boolean(
  env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET
);
