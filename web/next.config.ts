import path from "node:path";
import type { NextConfig } from "next";

// Where the Express API runs. The browser never calls it directly: it calls /api/* on this
// site, and Next.js forwards those requests (a "rewrite"). One site in the browser's eyes, so
// the API's httpOnly refresh cookie works with the strict SameSite=Lax setting, and no CORS.
const API_URL = process.env.API_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  // Next.js 16 rendering: pages are prerendered into a static shell; data marked 'use cache'
  // is part of it, and anything request-specific streams in behind <Suspense>
  cacheComponents: true,
  partialPrefetching: true,

  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },

  images: {
    // Product photos: our Cloudinary uploads, or a link an admin pasted (any https site)
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },

  turbopack: {
    // This folder is its own project (the API at the repo root has its own package-lock.json):
    // without this, Next.js guesses the repo root, and would also watch all the API's files
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
