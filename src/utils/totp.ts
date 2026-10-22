// TOTP: the 6-digit codes from an authenticator app (Google Authenticator, Authy, 1Password...).
// Standard: RFC 6238 (built on HOTP, RFC 4226). Small enough to write ourselves.
//
// The app and the server share a random SECRET. Every 30 seconds both compute:
//   step = floor(unix time / 30)
//   code = HMAC-SHA1(secret, step) → take 4 bytes from a place the hash itself chooses
//          → a number → its last 6 digits
// Same secret + same time = same code, without the phone ever talking to the server.
import crypto from "node:crypto";

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;

// Base32 (A-Z, 2-7): how authenticator apps expect the secret in a QR code or typed by hand
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const base32Encode = (bytes: Buffer): string => {
  let bits = "";
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    out += BASE32.charAt(parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2));
  }
  return out;
};

export const base32Decode = (text: string): Buffer => {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
};

// A new random secret: 20 bytes (160 bits), the size RFC 4226 recommends for SHA-1
export const generateTotpSecret = (): string => base32Encode(crypto.randomBytes(20));

export const timeStep = (unixSeconds: number): number => Math.floor(unixSeconds / TOTP_PERIOD_SECONDS);

// The code for one time step (HOTP with the step as the counter)
export const totpAt = (secret: Buffer, step: number): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = crypto.createHmac("sha1", secret).update(counter).digest();
  // "Dynamic truncation": the last 4 bits pick where to read 4 bytes from
  const offset = (hash[hash.length - 1] ?? 0) & 0x0f;
  const number = hash.readUInt32BE(offset) & 0x7fffffff;
  return String(number % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
};

// Checks a code. Accepts the current step and one step either side (±30 s), because phone and
// server clocks are never exactly in sync. Returns the step that matched (so the caller can
// refuse that same step again: no replays), or null.
export const verifyTotp = (secretBase32: string, code: string, unixSeconds = Date.now() / 1000): number | null => {
  if (!/^\d{6}$/.test(code)) {
    return null;
  }
  const secret = base32Decode(secretBase32);
  const now = timeStep(unixSeconds);
  for (const step of [now - 1, now, now + 1]) {
    const expected = Buffer.from(totpAt(secret, step));
    // Constant-time comparison: timing can't reveal how many digits were right
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) {
      return step;
    }
  }
  return null;
};

// The link an authenticator app reads from a QR code:
// otpauth://totp/Shop:riya@example.com?secret=...&issuer=Shop
export const otpauthUrl = ({ secret, account, issuer }: { secret: string; account: string; issuer: string }): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?` +
  new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SECONDS) });
