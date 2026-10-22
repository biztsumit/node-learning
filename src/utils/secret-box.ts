// Encrypts small secrets for storing in the database (the 2FA secrets).
//
// Hashing isn't possible here: to check a 2FA code the server needs the ORIGINAL secret back.
// So it's encrypted with AES-256-GCM, which also detects tampering: a changed byte makes
// decryption fail instead of quietly returning garbage.
//
// Stored as "v1:<iv>:<auth tag>:<ciphertext>" (base64url). The random IV means encrypting the
// same secret twice gives different text, so equal secrets can't be spotted in the database.
import crypto from "node:crypto";
import { env } from "../config/env.ts";

// A 32-byte key. From SECRETS_ENCRYPTION_KEY if set; otherwise derived from JWT_SECRET with
// HKDF (a standard way to turn one secret into a separate key for a different purpose).
const key: Buffer = Buffer.from(
  crypto.hkdfSync("sha256", env.SECRETS_ENCRYPTION_KEY ?? env.JWT_SECRET, "secret-box-salt", "2fa-secrets-v1", 32)
);

export const encryptSecret = (plain: string): string => {
  const iv = crypto.randomBytes(12);                  // 96-bit IV: the size GCM is designed for
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, encrypted].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(":");
};

export const decryptSecret = (stored: string): string => {
  const [version, iv, tag, encrypted] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unknown encrypted secret format");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
};
