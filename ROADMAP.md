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
- [ ] 7.5 Deployment
