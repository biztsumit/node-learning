// Loads .env and checks every setting the app needs, once, at startup.
// Import `env` from here instead of reading process.env directly.
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // "development" = readable coloured logs; "production" = one JSON object per line
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Logs below this level are skipped: trace < debug < info < warn < error < fatal ("silent" = none)
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),

  PORT: z.coerce.number().int().default(3000),

  // The database: EITHER one connection string (what hosting platforms give you)...
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, { error: "must start with postgres:// or postgresql://" }).optional(),
  // ...OR the separate parts (what we use locally)
  DB_HOST: z.string().min(1).optional(),
  DB_PORT: z.coerce.number().int().optional(),
  DB_USER: z.string().min(1).optional(),
  DB_PASSWORD: z.string().min(1).optional(),
  DB_NAME: z.string().min(1).optional(),
  // Encrypt the database connection (needed when connecting to a hosted database from outside)
  DB_SSL: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),

  JWT_SECRET: z.string().min(32, { error: "must be at least 32 characters" }),
  JWT_EXPIRES_IN: z.string().default("1d"),

  // Payments (optional): without these the app runs, but payment routes answer 503
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Unpaid orders are cancelled (and their stock released) after this many minutes.
  // Default 4320 = 3 days. Their items stay reserved for the whole time.
  ORDER_PAYMENT_TIMEOUT_MINUTES: z.coerce.number().int().min(1).default(3 * 24 * 60),
  // (The check runs once a minute as the "maintenance" job: see src/jobs/definitions.js)

  // Emails. "log" (default) doesn't send anything: it logs each email and, outside tests,
  // saves it as an HTML file in .emails/ so you can open it in a browser.
  // "brevo" really sends them (free plan: 300/day). https://www.brevo.com
  EMAIL_TRANSPORT: z.enum(["log", "brevo"]).default("log"),
  BREVO_API_KEY: z.string().min(1).optional(),
  // The sender. With Brevo it must be a sender you've verified in their dashboard.
  EMAIL_FROM_ADDRESS: z.email().default("orders@example.com"),
  EMAIL_FROM_NAME: z.string().min(1).default("Shop"),
  // Development / staging safety net: send EVERY email to this address instead of the real
  // customer (the subject says who it was meant for). Never set it in production.
  EMAIL_REDIRECT_TO: z.email().optional(),

  // Image uploads (optional): without these the app runs, but upload routes answer 503.
  // All three are on the Cloudinary dashboard: https://console.cloudinary.com
  CLOUDINARY_CLOUD_NAME: z.string().regex(/^[a-z0-9_-]+$/i, { error: "must be your Cloudinary cloud name" }).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),

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
})
  .superRefine((settings, ctx) => {
    if (settings.EMAIL_TRANSPORT === "brevo" && !settings.BREVO_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["BREVO_API_KEY"], message: "required when EMAIL_TRANSPORT=brevo" });
    }
    if (settings.DATABASE_URL) {
      return;
    }
    for (const key of ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
      if (settings[key] === undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: "required (or set DATABASE_URL instead)" });
      }
    }
  });

// A setting that's present but empty ("RAZORPAY_KEY_ID=") counts as not set.
// Hosting dashboards often create empty variables for fields you leave blank.
const settings = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== "")
);

const result = envSchema.safeParse(settings);

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

export const uploadsEnabled = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
);
