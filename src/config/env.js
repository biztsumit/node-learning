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
  JWT_EXPIRES_IN: z.string().default("1d")
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
