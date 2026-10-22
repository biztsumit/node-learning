# Shop: the storefront (Next.js)

The customer-facing website for the e-commerce API in the repository root.
Next.js 16 (App Router, Cache Components), React 19, TypeScript and Tailwind CSS.

## Run it locally

1. Start the API (repo root): `npm run dev` (port 3000). In the API's `.env`, set:
   ```
   REFRESH_COOKIE_PATH=/api/auth
   CORS_ORIGINS=http://localhost:3100
   ```
2. Here in `web/`:
   ```
   cp .env.example .env.local     # API_URL=http://localhost:3000
   npm install
   npm run dev                    # http://localhost:3100
   ```

`npm run build` prerenders the catalog from the API's data, so **the API must be running** for a build.

## How it fits together

- **One site for the browser.** The browser only ever talks to this app. Requests to `/api/*` are
  forwarded to the API (a rewrite in `next.config.ts`). So the API's refresh-token cookie is a
  same-site cookie (`SameSite=Lax`, `httpOnly`, path `/api/auth`), and no CORS is needed.
- **Public pages are rendered on the server and cached.** Home, the product list and product pages
  call the API from the server (`src/lib/catalog.ts`) inside `'use cache'` functions. The home page and
  the newest products are prerendered at build time; the rest are cached on first visit.
  Anything that depends on the request (the URL's search filters) streams in behind `<Suspense>`.
- **Private pages are rendered in the browser.** The cart, login and account use
  `src/lib/client-api.ts`: the 15-minute access token lives only in memory, and the httpOnly
  refresh cookie restores the session after a reload (`src/components/auth-provider.tsx`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3100 |
| `npm run build` / `npm start` | Production build / server (port 3100) |
| `npm run lint` | ESLint (Next.js and React rules) |
| `npm run typecheck` | Generates route types, then type-checks |
