// Everything that talks to Cloudinary lives in this one file.
// Docs: https://cloudinary.com/documentation/upload_images#authenticated_requests
import crypto, { randomUUID } from "node:crypto";
import { env } from "../config/env.js";

// Every product image is stored under this path in your Cloudinary account
export const PRODUCT_IMAGE_FOLDER = "ecommerce/products";
export const ALLOWED_FORMATS = ["jpg", "png", "webp"];

// Cloudinary refuses an upload whose signed timestamp is more than 1 hour old
const SIGNATURE_LIFETIME_SECONDS = 60 * 60;

const API_URL = () => `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}`;

// Cloudinary's signature: sort the parameters by name, join as "a=1&b=2",
// add your API secret on the end, and take the SHA-1 hash.
// Only someone who knows the secret (you, and Cloudinary) can produce it.
export const signParams = (params) => {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + env.CLOUDINARY_API_SECRET).digest("hex");
};

// Permission for the BROWSER to upload one image straight to Cloudinary.
// We choose the file's name (public_id), its folder and the allowed formats, and sign them,
// so the browser can't upload anywhere else or as anything else.
export const createProductImageUpload = () => {
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
      api_key: env.CLOUDINARY_API_KEY,
      signature: signParams(params)
    },
    expiresAt: new Date((params.timestamp + SIGNATURE_LIFETIME_SECONDS) * 1000).toISOString()
  };
};

// Is this the URL of an image in OUR product folder? Returns its public id, or null.
// e.g. https://res.cloudinary.com/<cloud>/image/upload/v1712345678/ecommerce/products/<uuid>.jpg
export const productImagePublicId = (url) => {
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
export const thumbnailUrl = (url) =>
  productImagePublicId(url) ? url.replace("/image/upload/", "/image/upload/c_fill,w_400,h_400,f_auto,q_auto/") : url;

// Deletes an image from Cloudinary. Used when an image is replaced or its product deleted.
export const deleteImage = async (publicId) => {
  const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000) };

  const response = await fetch(`${API_URL()}/image/destroy`, {
    method: "POST",
    body: new URLSearchParams({ ...params, api_key: env.CLOUDINARY_API_KEY, signature: signParams(params) }),
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.json().catch(() => ({}));

  // "not found" is fine: the goal (image gone) is already true
  if (!response.ok || (body.result !== "ok" && body.result !== "not found")) {
    throw new Error(`Cloudinary delete failed (${response.status}): ${body.error?.message ?? body.result ?? "unknown error"}`);
  }
};
