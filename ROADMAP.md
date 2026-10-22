# E-commerce Backend Roadmap

A step-by-step plan for building a production-ready e-commerce API with
Node.js, Express and PostgreSQL. Each step teaches one set of backend concepts.

## Done so far

- [x] Express server + PostgreSQL connection
- [x] Layered structure: routes → controllers → services
- [x] Products CRUD
- [x] Register / login with bcrypt + JWT
- [x] Roles (user / admin) and route guards
- [x] Admin-only `GET /users`, JSON 404 handler

## Phase 1 — Solid foundations

- [x] 1.1 Database migrations + seed script (instead of creating tables at startup)
- [x] 1.2 Request validation with `zod`
- [x] 1.3 Central error handling (`AppError`) and consistent responses
- [x] 1.4 Git + check required `.env` values at startup

## Phase 2 — Product catalog

- [x] 2.1 Categories (first foreign key: product → category)
- [x] 2.2 Richer products: description, stock, image URL, slug
- [x] 2.3 Pagination, search, filter by category/price, sorting

## Phase 3 — Shopping cart

- [x] 3.1 Cart per user: add, update quantity, remove, view with totals

## Phase 4 — Orders

- [x] 4.1 Checkout: cart → order inside a **transaction**, reduce stock
- [x] 4.2 Order history for users; order status updates for admins
- [x] 4.3 Shipping addresses

## Phase 5 — Payments

- [x] 5.1 Payment gateway in test mode (Razorpay)
- [x] 5.2 Webhooks to confirm payments

## Phase 6 — Accounts & reviews

- [x] 6.1 Update profile, change password
- [x] 6.2 Product reviews and ratings

## Phase 7 — Production ready

- [x] 7.1 Security: helmet, CORS, rate limiting
- [x] 7.2 Logging
- [x] 7.3 Automated tests (node:test + Supertest)
- [x] 7.4 API docs (Swagger / OpenAPI)
- [x] 7.5 Deployment to Render: https://ecommerce-api-we2w.onrender.com
- [x] 7.6 UUIDv7 ids everywhere (migration 013, existing data converted)

---

# Next: advanced features

Ordered so each phase builds on the previous one. ⭐ = recommended next.

## Phase 8 — Close the business-logic gaps

- [x] 8.1 CI: GitHub Actions runs `npm test` on every push (PostgreSQL 18 service); Render deploys only when green
- [x] 8.2 Expire unpaid orders: a background job cancels `pending` orders after 3 days (configurable) and releases their stock (`FOR UPDATE SKIP LOCKED`)
- [x] 8.3 Idempotency keys (`Idempotency-Key` header) for checkout and add-to-cart: retries replay the first response instead of repeating the action
- [x] 8.4 Automatic Razorpay refunds when a paid order is cancelled or money arrives late; retried by the job, tracked by webhooks
- [x] 8.5 Human-friendly order numbers (`ORD-7K3M9Q`): random, no look-alike characters, unique with a savepoint retry

## Phase 9 — Background work, Redis and email

- [x] 9.1 Job queue on PostgreSQL (pg-boss): retries with backoff, scheduled maintenance that runs once across all servers
- [x] 9.2 Order emails (placed, paid, shipped, delivered, cancelled, refunded): queued inside the transaction; "log" mode or Brevo
- [x] 9.3 Forgot password and email verification: one-time, hashed, expiring tokens; no account enumeration
- [x] 9.4 In-memory caching of catalog reads, cleared on any change via PostgreSQL LISTEN/NOTIFY (Redis-backed rate limits: later, if running several servers)

## Phase 10 — A richer store

- [x] 10.1 Product variants (size / colour) with their own SKU, price and stock
- [x] 10.2 Image uploads: signed direct uploads to Cloudinary, thumbnails, automatic clean-up
- [x] 10.3 Real search: PostgreSQL full-text search with ranking, typo-tolerant matching (`pg_trgm`)
- [x] 10.4 Coupons and discounts (percent / fixed, expiry, usage limits — safe under concurrency)
- [x] 10.5 Wishlist, and a stock-movement ledger (every stock change recorded with its reason)
- [x] 10.6 Cursor pagination for very large lists

## Phase 11 — Admin insights

- [x] 11.1 Sales dashboard API: revenue per day, top products, repeat customers (window functions, materialized views)
- [x] 11.2 Audit log: who changed what, when (prices, order statuses, roles)

## Phase 12 — Engineering maturity

- [ ] 12.1 Docker + docker-compose (app, PostgreSQL, migrations; no Redis needed) for one-command setup: files written, verified by the CI "docker" job
- [ ] 12.2 TypeScript, gradually (Node 24 runs .ts directly; `npm run typecheck` in CI)
  - [x] Foundation: settings, errors, order rules, cursors, request context, transactions, auth (+ typed `req.user`)
  - [x] Validators (each exports its z.infer type) and the validate middleware
  - [ ] Services (done: category, wishlist, audit, user, stock, auth-token, account, razorpay, cloudinary, variant, cart, refund; left: coupon, payment, report, product, order, review, address), then controllers and routes, then tests; finally `allowJs: false`
- [ ] 12.3 Observability: error tracking (Sentry), metrics (`/metrics` for Prometheus), tracing (OpenTelemetry)
- [ ] 12.4 Refresh tokens in httpOnly cookies; two-factor login for admins
- [ ] 12.5 A staging environment that mirrors production

## Phase 13 — A frontend

- [ ] 13.1 React + Vite storefront and admin panel using this API (CORS, auth, Razorpay Checkout)
