import { z } from "zod";

const emailSchema = z
  .string({ error: "email is required" })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "email must be a valid email address" }));

export const registerSchema = z.object({
  name: z
    .string({ error: "name is required" })
    .trim()
    .min(1, { error: "name is required" })
    .max(255, { error: "name must be at most 255 characters" }),
  email: emailSchema,
  password: z
    .string({ error: "password is required" })
    .min(6, { error: "password must be at least 6 characters" })
    .max(72, { error: "password must be at most 72 characters" })
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: "password is required" })
    .min(1, { error: "password is required" })
});
