"use client";

import { getAccessToken, refreshAccessToken } from "@/lib/client-api";
import { catalogChanged } from "../actions";

// Tells the Next server that products changed, so the storefront stops showing its cached
// copy (see actions.ts). If the access token had just expired, get a new one and try once more.
// A failure here isn't worth bothering the admin with: the cache expires on its own soon.
export async function notifyCatalogChanged(): Promise<void> {
  try {
    if ((await catalogChanged(getAccessToken())) === "unauthorized" && (await refreshAccessToken())) {
      await catalogChanged(getAccessToken());
    }
  } catch {
    // The storefront catches up when its cache runs out (a few minutes)
  }
}
