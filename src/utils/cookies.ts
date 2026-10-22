import type { CookieOptions, Response } from "express";
import { env } from "../config/env.ts";

// The refresh token's cookie
export const REFRESH_COOKIE = "refresh_token";

// Only sent to the /auth routes (refresh, logout), never with ordinary API requests
const REFRESH_COOKIE_PATH = "/auth";

// httpOnly: page JavaScript can't read it, so an XSS bug can't steal it.
// secure: only sent over HTTPS (required by browsers for SameSite=None).
// sameSite: which sites may make the browser send it (see REFRESH_COOKIE_SAMESITE in env.ts).
const refreshCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production" || env.REFRESH_COOKIE_SAMESITE === "none",
  sameSite: env.REFRESH_COOKIE_SAMESITE,
  path: REFRESH_COOKIE_PATH
});

export const setRefreshCookie = (res: Response, token: string, expiresAt: Date): void => {
  res.cookie(REFRESH_COOKIE, token, { ...refreshCookieOptions(), expires: expiresAt });
};

export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
};

// Reads one cookie from the Cookie header ("a=1; refresh_token=abc; b=2"). Small enough not
// to need the cookie-parser package.
export const readCookie = (header: string | undefined, name: string): string | undefined => {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
};
