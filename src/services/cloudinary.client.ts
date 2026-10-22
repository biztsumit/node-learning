// Everything that talks to Cloudinary lives in this one file.
// Docs: https://cloudinary.com/documentation/upload_images#authenticated_requests
import crypto, { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.ts";

// Every product image is stored under this path in your Cloudinary account
export const PRODUCT_IMAGE_FOLDER = "ecommerce/products";
export const ALLOWED_FORMATS = ["jpg", "png", "webp"] as const;

// Cloudinary refuses an upload whose signed timestamp is more than 1 hour old
const SIGNATURE_LIFETIME_SECONDS = 60 * 60;

// Uploads are optional (upload routes answer 503 without these), so they may be missing
const setting = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(`Cloudinary isn't configured: ${name} is missing`);
  }
  return value;
};

const API_URL = () => `https://api.cloudinary.com/v1_1/${setting(env.CLOUDINARY_CLOUD_NAME, "CLOUDINARY_CLOUD_NAME")}`;

// What we sign: text and numbers (the timestamp)
type SignedParams = Record<string, string | number>;

// Cloudinary's signature: sort the parameters by name, join as "a=1&b=2",
// add your API secret on the end, and take the SHA-1 hash.
// Only someone who knows the secret (you, and Cloudinary) can produce it.
export const signParams = (params: SignedParams): string => {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + setting(env.CLOUDINARY_API_SECRET, "CLOUDINARY_API_SECRET")).digest("hex");
};

export type ProductImageUpload = {
  uploadUrl: string;
  fields: SignedParams & { api_key: string; signature: string };
  expiresAt: string;
};

// Permission for the BROWSER to upload one image straight to Cloudinary.
// We choose the file's name (public_id), its folder and the allowed formats, and sign them,
// so the browser can't upload anywhere else or as anything else.
export const createProductImageUpload = (): ProductImageUpload => {
  const params = {
    public_id: `${PRODUCT_IMAGE_FOLDER}/${randomUUID()}`,
    allowed_formats: ALLOWED_FORMATS.join(","),
    timestamp: Math.floor(Date.now() / 1000)
  };

  return {
    uploadUrl: `${API_URL()}/image/upload`,
    // Send all of these as form fields together with the file:
    fields: {
      ...params,
      api_key: setting(env.CLOUDINARY_API_KEY, "CLOUDINARY_API_KEY"),
      signature: signParams(params)
    },
    expiresAt: new Date((params.timestamp + SIGNATURE_LIFETIME_SECONDS) * 1000).toISOString()
  };
};

// Is this the URL of an image in OUR product folder? Returns its public id, or null.
// e.g. https://res.cloudinary.com/<cloud>/image/upload/v1712345678/ecommerce/products/<uuid>.jpg
export const productImagePublicId = (url: unknown): string | null => {
  if (typeof url !== "string" || !env.CLOUDINARY_CLOUD_NAME) {
    return null;
  }
  const pattern = new RegExp(
    `^https://res\\.cloudinary\\.com/${env.CLOUDINARY_CLOUD_NAME}/image/upload/(?:v\\d+/)?` +
    `(${PRODUCT_IMAGE_FOLDER}/[0-9a-f-]{36})\\.(?:${ALLOWED_FORMATS.join("|")})$`
  );
  return url.match(pattern)?.[1] ?? null;
};

// A resized copy for product lists, made by Cloudinary on the fly from the original:
// 400×400, cropped to fill, best format for the browser (WebP/AVIF), automatic quality.
export const thumbnailUrl = (url: string): string =>
  productImagePublicId(url) ? url.replace("/image/upload/", "/image/upload/c_fill,w_400,h_400,f_auto,q_auto/") : url;

// Cloudinary's answer to a delete: { result: "ok" } or { result: "not found" } (or an error)
const destroyResponseSchema = z.object({
  result: z.string().optional(),
  error: z.object({ message: z.string() }).optional()
});

// Deletes an image from Cloudinary. Used when an image is replaced or its product deleted.
export const deleteImage = async (publicId: string): Promise<void> => {
  const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };

  // URLSearchParams wants text only: the timestamp becomes "1712345678" (as it would anyway)
  const form = new URLSearchParams({
    public_id: params.public_id,
    timestamp: String(params.timestamp),
    api_key: setting(env.CLOUDINARY_API_KEY, "CLOUDINARY_API_KEY"),
    signature: signParams(params)
  });

  const response = await fetch(`${API_URL()}/image/destroy`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(10_000)
  });
  const parsed = destroyResponseSchema.safeParse(await response.json().catch(() => ({})));
  const body = parsed.success ? parsed.data : {};

  // "not found" is fine: the goal (image gone) is already true
  if (!response.ok || (body.result !== "ok" && body.result !== "not found")) {
    throw new Error(`Cloudinary delete failed (${response.status}): ${body.error?.message ?? body.result ?? "unknown error"}`);
  }
};
