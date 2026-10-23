"use server";

// SERVER ACTIONS: functions that run on the Next server but are called from the browser like
// a normal function. Next turns each call into a POST request behind the scenes.
//
// Because it is a POST endpoint, ANYONE can call it, not just our admin pages. So the action
// checks who is asking before doing anything, exactly like an API route would.
import { updateTag } from "next/cache";
import type { User } from "@/lib/types";

const API_URL = process.env.API_URL ?? "http://localhost:3000";

// After an admin changes a product, the storefront's cached catalog (lib/catalog.ts, tagged
// "products") is out of date. updateTag expires it straight away, so the next visitor sees
// the change instead of waiting for cacheLife to run out.
//
// Returns "unauthorized" when the token was missing or expired: the browser then gets a fresh
// token and tries once more.
export async function catalogChanged(accessToken: string | null): Promise<"ok" | "unauthorized" | "forbidden"> {
  if (!accessToken) {
    return "unauthorized";
  }
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (res.status === 401) {
    return "unauthorized";
  }
  const body = res.ok ? ((await res.json()) as { data: User }) : null;
  if (body?.data.role !== "admin") {
    return "forbidden";
  }

  updateTag("products");
  return "ok";
}
