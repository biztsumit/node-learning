import { z } from "zod";

const requiredText = (label: string, max: number) => z
  .string({ error: `${label} is required` })
  .trim()
  .min(1, { error: `${label} is required` })
  .max(max, { error: `${label} must be at most ${max} characters` });

// Optional text: "" or null both mean "not given" and are stored as NULL
const optionalText = (label: string, max: number) => z
  .string({ error: `${label} must be text` })
  .trim()
  .max(max, { error: `${label} must be at most ${max} characters` })
  .nullable()
  .transform((value) => value || null);

const addressFields = {
  label: optionalText("label", 50),
  fullName: requiredText("fullName", 100),
  phone: z
    .string({ error: "phone is required" })
    .trim()
    .regex(/^\+?[0-9][0-9\s-]{6,18}$/, { error: "phone must be a valid phone number" }),
  line1: requiredText("line1", 255),
  line2: optionalText("line2", 255),
  city: requiredText("city", 100),
  state: requiredText("state", 100),
  postalCode: requiredText("postalCode", 20),
  country: z
    .string({ error: "country must be text" })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, { error: "country must be a 2-letter code, e.g. IN" }),
  isDefault: z.boolean({ error: "isDefault must be true or false" })
};

// Indian PIN codes are exactly 6 digits. Returns an error message, or null if it's fine.
// Shared with address.services.js, which checks PATCHes against the address's saved country.
export const postalCodeProblem = (country: string | undefined, postalCode: string): string | null => {
  if (country === "IN" && !/^\d{6}$/.test(postalCode)) {
    return "postalCode must be a 6-digit PIN code for India";
  }
  return null;
};

const checkPostalCode = (address: { country?: string; postalCode: string }, ctx: z.RefinementCtx) => {
  const problem = postalCodeProblem(address.country, address.postalCode);
  if (problem) {
    ctx.addIssue({ code: "custom", path: ["postalCode"], message: problem });
  }
};

// POST /addresses — everything required except label, line2, country (IN) and isDefault (false)
export const createAddressSchema = z
  .object({
    ...addressFields,
    label: addressFields.label.optional(),
    line2: addressFields.line2.optional(),
    country: addressFields.country.default("IN"),
    isDefault: addressFields.isDefault.default(false)
  })
  .superRefine(checkPostalCode);

// PATCH /addresses/:id — send only the fields you want to change.
// The PIN code check needs the saved country too, so it runs in the service instead.
export const updateAddressSchema = z
  .object(addressFields)
  .partial()
  .refine((fields) => Object.keys(fields).length > 0, { error: "Send at least one field to update" });

// The TypeScript types of the CHECKED data (after trimming, defaults, coercion...).
// Services use these, so the shape is written once: in the schema.
export type CreateAddress = z.infer<typeof createAddressSchema>;
export type UpdateAddress = z.infer<typeof updateAddressSchema>;
