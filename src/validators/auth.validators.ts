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

// PATCH /auth/me — only the name can be changed here.
// (Changing email safely needs a "confirm your new email" step, so it isn't offered.)
export const updateProfileSchema = z.object({
  name: z
    .string({ error: "name is required" })
    .trim()
    .min(1, { error: "name is required" })
    .max(255, { error: "name must be at most 255 characters" })
});

// POST /auth/change-password
export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ error: "currentPassword is required" })
      .min(1, { error: "currentPassword is required" }),
    newPassword: z
      .string({ error: "newPassword is required" })
      .min(6, { error: "newPassword must be at least 6 characters" })
      .max(72, { error: "newPassword must be at most 72 characters" })
  })
  .refine((body) => body.newPassword !== body.currentPassword, {
    error: "newPassword must be different from currentPassword",
    path: ["newPassword"]
  });

// One-time link tokens: 43 URL-safe characters (32 random bytes)
const linkTokenSchema = z
  .string({ error: "token is required" })
  .trim()
  .regex(/^[A-Za-z0-9_-]{20,200}$/, { error: "token is not valid" });

// POST /auth/forgot-password
export const forgotPasswordSchema = z.object({
  email: emailSchema
});

// POST /auth/reset-password
export const resetPasswordSchema = z.object({
  token: linkTokenSchema,
  newPassword: z
    .string({ error: "newPassword is required" })
    .min(6, { error: "newPassword must be at least 6 characters" })
    .max(72, { error: "newPassword must be at most 72 characters" })
});

// POST /auth/verify-email
export const verifyEmailSchema = z.object({
  token: linkTokenSchema
});

// A code from the authenticator app ("123 456" → "123456") or a recovery code ("k7m2-q9xp")
const secondFactorCode = z
  .string({ error: "code is required" })
  .trim()
  .min(6, { error: "code must be the 6-digit code from your app, or a recovery code" })
  .max(20, { error: "code is too long" })
  .transform((code) => (/^[\d\s]+$/.test(code) ? code.replace(/\s/g, "") : code));

// POST /auth/2fa/enable  { code }
export const enableTwoFactorSchema = z.object({
  code: z.string({ error: "code is required" }).trim().regex(/^\d{6}$/, { error: "code must be the 6-digit code from your app" })
});

// POST /auth/login/2fa  { challengeToken, code }: the second step of a login
export const loginTwoFactorSchema = z.object({
  challengeToken: z.string({ error: "challengeToken is required" }).min(1, { error: "challengeToken is required" }).max(1000),
  code: secondFactorCode
});

// POST /auth/2fa/disable  { password, code }
export const disableTwoFactorSchema = z.object({
  password: z.string({ error: "password is required" }).min(1, { error: "password is required" }),
  code: secondFactorCode
});

// The TypeScript types of the CHECKED data (after trimming, defaults, coercion...).
// Services use these, so the shape is written once: in the schema.
export type Register = z.infer<typeof registerSchema>;
export type Login = z.infer<typeof loginSchema>;
export type UpdateProfile = z.infer<typeof updateProfileSchema>;
export type ChangePassword = z.infer<typeof changePasswordSchema>;
export type ForgotPassword = z.infer<typeof forgotPasswordSchema>;
export type ResetPassword = z.infer<typeof resetPasswordSchema>;
export type VerifyEmail = z.infer<typeof verifyEmailSchema>;
export type EnableTwoFactor = z.infer<typeof enableTwoFactorSchema>;
export type LoginTwoFactor = z.infer<typeof loginTwoFactorSchema>;
export type DisableTwoFactor = z.infer<typeof disableTwoFactorSchema>;
