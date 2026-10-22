// The OpenAPI description of this API, served at /docs (interactive) and /docs/openapi.json.
//
// Request bodies and query strings are generated FROM THE SAME ZOD SCHEMAS the routes use
// to validate, so the docs can't drift away from what the API really accepts.
import { z } from "zod";
import { MAX_QUANTITY_PER_ITEM, addCartItemSchema, updateCartItemSchema } from "../validators/cart.validators.ts";
import { registerSchema, loginSchema, updateProfileSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema, loginTwoFactorSchema, enableTwoFactorSchema, disableTwoFactorSchema } from "../validators/auth.validators.ts";
import { categorySchema } from "../validators/category.validators.ts";
import { productSchema, productUpdateSchema, productListQuerySchema } from "../validators/product.validators.ts";
import { createVariantSchema, updateVariantSchema } from "../validators/variant.validators.ts";
import { createAddressSchema, updateAddressSchema } from "../validators/address.validators.ts";
import { checkoutSchema, orderListQuerySchema, adminOrderListQuerySchema, updateOrderStatusSchema, orderNumberParamSchema } from "../validators/order.validators.ts";
import { verifyPaymentSchema } from "../validators/payment.validators.ts";
import { roleSchema, auditLogQuerySchema } from "../validators/audit.validators.ts";
import { summaryQuerySchema, revenueQuerySchema, topProductsQuerySchema, customersQuerySchema } from "../validators/report.validators.ts";
import { stockAdjustmentSchema, stockMovementListQuerySchema } from "../validators/stock.validators.ts";
import { cartQuerySchema, couponListQuerySchema, createCouponSchema, updateCouponSchema } from "../validators/coupon.validators.ts";
import { productImageSchema } from "../validators/upload.validators.ts";
import { createReviewSchema, updateReviewSchema, reviewListQuerySchema } from "../validators/review.validators.ts";
import { ORDER_STATUSES } from "../utils/order-status.ts";

// Every id in this API is a UUID (time-ordered UUIDv7)
const UUID = { type: "string", format: "uuid", example: "01a14386-1238-7b41-9618-7ff4c0a7b55d" };

// ---------- Turning zod schemas into OpenAPI pieces ----------

// "input" = describe what the CLIENT sends (fields with defaults are optional)
const fromZod = (schema: z.ZodType) => {
  const { $schema, ...jsonSchema } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  return jsonSchema;
};

const jsonBody = (schema: z.ZodType) => ({
  required: true,
  content: { "application/json": { schema: fromZod(schema) } }
});

// One OpenAPI "parameter" per field of a query-string schema
// Report days are plain "YYYY-MM-DD" in Indian time
const DAY = { type: "string", format: "date", example: "2026-10-22" };
const DATA_AS_OF = { type: ["string", "null"], format: "date-time", description: "When the daily numbers were last recalculated (every 10 minutes)" };
const REPORT_NOTES = "Sales = orders that are paid, shipped or delivered, counted on the day they were placed (Indian time). Leave out from/to for the last 30 days. Comes from a snapshot recalculated every 10 minutes (see dataAsOf; POST /admin/reports/refresh to update it now).";

const queryParams = (schema: z.ZodType) => {
  const { properties = {}, required = [] } = fromZod(schema);
  return Object.entries(properties).map(([name, fieldSchema]) => ({
    name,
    in: "query",
    required: required.includes(name),
    schema: fieldSchema
  }));
};

// Optional header for actions that must not happen twice (see the middleware for the rules)
const IDEMPOTENCY_KEY = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description: "A random key you create once per action (e.g. crypto.randomUUID()) and resend on every retry of it. A retry gets the original response back (header `Idempotency-Replayed: true`) instead of doing the action again. Kept for 24 hours, per user.",
  schema: { type: "string", minLength: 8, maxLength: 255, pattern: "^[A-Za-z0-9_-]+$", example: "3f6b1c9e-8e2a-4c1d-9b7a-2d5e6f708192" }
};

const pathId = (name = "id", description?: string) => ({
  name,
  in: "path",
  required: true,
  description,
  schema: UUID
});

// ---------- Responses ----------

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

// { success: true, data: ... }
const ok = (description: string, data: object | undefined, { status = 200, pagination = false } = {}) => ({
  [status]: {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            success: { const: true },
            ...(data && { data }),
            ...(pagination && { pagination: ref("Pagination") })
          }
        }
      }
    }
  }
});

const message = (description: string) => ok(description, undefined);

// Error responses shared by many routes
const errors = (...codes: number[]) => Object.fromEntries(codes.map((code) => [code, { $ref: `#/components/responses/${code}` }]));

const PUBLIC = { security: [] };
const LOGGED_IN = { security: [{ bearerAuth: [] }] };

// The order number's rules (pattern etc.), from its zod schema. A JSON schema can also be
// "true"/"false" in general, so keep it only if it's an object.
const orderNumberField = fromZod(orderNumberParamSchema).properties?.orderNumber;
const orderNumberSchema = typeof orderNumberField === "object" ? orderNumberField : {};

// ---------- The document ----------

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "E-commerce API",
    version: "1.0.0",
    description: [
      "Products, cart, checkout, Razorpay payments and reviews.",
      "",
      "**Logging in:** call `POST /auth/login`, copy `data.token`, click **Authorize** and paste it.",
      "",
      "**Money:** prices are whole rupees (₹799 = `799`). Razorpay amounts are in paise (`79900`).",
      "",
      "**Errors** always look like `{ \"success\": false, \"message\": \"...\" }`, plus an `errors` list for validation problems."
    ].join("\n")
  },
  servers: [{ url: "/", description: "This server" }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "Auth", description: "Accounts, login and sessions" },
    { name: "Catalog", description: "Categories and products (reading is public)" },
    { name: "Reviews", description: "Ratings from customers who received the product" },
    { name: "Cart", description: "The logged-in user's shopping cart" },
    { name: "Addresses", description: "Saved shipping addresses" },
    { name: "Orders", description: "Checkout, order history and payments" },
    { name: "Admin", description: "Admin-only management" },
    { name: "Reports", description: "Admin-only sales dashboard" },
    { name: "Webhooks", description: "Called by Razorpay's servers, not by apps" },
    { name: "System", description: "Status of the service" }
  ],

  paths: {
    "/": {
      get: { tags: ["System"], summary: "Welcome message", ...PUBLIC, responses: { 200: { description: "The API is running" } } }
    },
    "/health": {
      get: {
        tags: ["System"], summary: "Health check (used by the hosting platform)", ...PUBLIC,
        responses: {
          200: { description: "The app and its database are working" },
          503: { description: "The database can't be reached" }
        }
      }
    },

    // ----- Auth -----
    "/auth/register": {
      post: {
        tags: ["Auth"], summary: "Create an account", ...PUBLIC,
        description: "Email is trimmed and lowercased. Limited to a few sign-ups per hour per IP.",
        requestBody: jsonBody(registerSchema),
        responses: { ...ok("Account created", ref("AuthResult"), { status: 201 }), ...errors(400, 409, 429) }
      }
    },
    "/auth/login": {
      post: {
        tags: ["Auth"], summary: "Log in and get a token", ...PUBLIC,
        description: "Only failed attempts count towards the rate limit. Returns a 15-minute access token, and sets the refresh token as an httpOnly cookie (`refresh_token`, path /auth). With two-factor login on, the answer is instead `{ twoFactorRequired: true, challengeToken }`: send it with a code to POST /auth/login/2fa within 5 minutes.",
        requestBody: jsonBody(loginSchema),
        responses: { ...ok("Logged in (or a two-factor challenge)", { oneOf: [ref("AuthResult"), ref("TwoFactorChallenge")] }), ...errors(400, 401, 429) }
      }
    },
    "/auth/login/2fa": {
      post: {
        tags: ["Auth"], summary: "Second step of a two-factor login", ...PUBLIC,
        description: "`code` is the 6-digit code from the authenticator app, or one of the recovery codes (each works once).",
        requestBody: jsonBody(loginTwoFactorSchema),
        responses: { ...ok("Logged in", ref("AuthResult")), ...errors(400, 401, 429) }
      }
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"], summary: "Get a new access token with the refresh-token cookie", ...PUBLIC,
        description: "Send with the cookie (browsers: `credentials: 'include'`). Returns a new access token and replaces the refresh token. A refresh token that was already used ends the whole session (it was probably copied). 409 if another tab refreshed the same session a moment ago: retry.",
        responses: { ...ok("Refreshed", { type: "object", properties: { token: { type: "string" }, accessTokenExpiresIn: { type: "string", example: "15m" } } }), ...errors(401, 403, 409) }
      }
    },
    "/auth/logout": {
      post: { tags: ["Auth"], summary: "Log out on this device (ends this session, clears the cookie)", ...PUBLIC, responses: { ...message("Logged out"), ...errors(403) } }
    },
    "/auth/2fa": {
      get: {
        tags: ["Auth"], summary: "Is two-factor login on? How many recovery codes are left?", ...LOGGED_IN,
        responses: { ...ok("Status", { type: "object", properties: { enabled: { type: "boolean" }, recoveryCodesLeft: { type: "integer" } } }), ...errors(401) }
      }
    },
    "/auth/2fa/setup": {
      post: {
        tags: ["Auth"], summary: "Start setting up two-factor login", ...LOGGED_IN,
        description: "Returns the secret for an authenticator app: show `otpauthUrl` as a QR code (or let the user type `secret`). Nothing changes until POST /auth/2fa/enable with a code.",
        responses: { ...ok("Secret", { type: "object", properties: { secret: { type: "string", example: "JBSWY3DPEHPK3PXP" }, otpauthUrl: { type: "string" } } }), ...errors(401, 409) }
      }
    },
    "/auth/2fa/enable": {
      post: {
        tags: ["Auth"], summary: "Turn two-factor login on (with a code from the app)", ...LOGGED_IN,
        description: "Returns 10 one-time recovery codes. They're shown only this once.",
        requestBody: jsonBody(enableTwoFactorSchema),
        responses: { ...ok("On", { type: "object", properties: { recoveryCodes: { type: "array", items: { type: "string", example: "k7m2-q9xp" } } } }), ...errors(400, 401, 409, 429) }
      }
    },
    "/auth/2fa/disable": {
      post: {
        tags: ["Auth"], summary: "Turn two-factor login off (password + code)", ...LOGGED_IN,
        requestBody: jsonBody(disableTwoFactorSchema),
        responses: { ...message("Off"), ...errors(400, 401, 429) }
      }
    },
    "/auth/me": {
      get: { tags: ["Auth"], summary: "My profile", ...LOGGED_IN, responses: { ...ok("Profile", ref("User")), ...errors(401) } },
      patch: {
        tags: ["Auth"], summary: "Change my name", ...LOGGED_IN,
        requestBody: jsonBody(updateProfileSchema),
        responses: { ...ok("Updated profile", ref("User")), ...errors(400, 401) }
      }
    },
    "/auth/change-password": {
      post: {
        tags: ["Auth"], summary: "Change my password", ...LOGGED_IN,
        description: "Logs out every device. The response contains a fresh token for this one.",
        requestBody: jsonBody(changePasswordSchema),
        responses: {
          ...ok("Password changed", { type: "object", properties: { token: { type: "string" } } }),
          ...errors(400, 401, 429)
        }
      }
    },
    "/auth/forgot-password": {
      post: {
        tags: ["Auth"], summary: "Email me a link to reset my password", ...PUBLIC,
        description: "Always answers the same way, whether or not the email has an account, so nobody can use it to find out who's a customer. The link works once and expires in 1 hour.",
        requestBody: jsonBody(forgotPasswordSchema),
        responses: { ...message("Link sent if the account exists"), ...errors(400, 429) }
      }
    },
    "/auth/reset-password": {
      post: {
        tags: ["Auth"], summary: "Set a new password with the emailed link's token", ...PUBLIC,
        description: "Logs out every device. The token is the `token` part of the link in the email.",
        requestBody: jsonBody(resetPasswordSchema),
        responses: { ...message("Password changed"), ...errors(400, 429) }
      }
    },
    "/auth/verify-email": {
      post: {
        tags: ["Auth"], summary: "Confirm my email address with the emailed link's token", ...PUBLIC,
        requestBody: jsonBody(verifyEmailSchema),
        responses: { ...message("Email verified"), ...errors(400, 429) }
      }
    },
    "/auth/resend-verification": {
      post: {
        tags: ["Auth"], summary: "Send me a new email-verification link", ...LOGGED_IN,
        responses: { ...message("New link sent"), ...errors(401, 409, 429) }
      }
    },
    "/auth/logout-all": {
      post: { tags: ["Auth"], summary: "Log out on every device (every access token and session ends)", ...LOGGED_IN, responses: { ...message("Logged out everywhere"), ...errors(401) } }
    },

    // ----- Catalog -----
    "/categories": {
      get: { tags: ["Catalog"], summary: "List categories", ...PUBLIC, responses: ok("Categories", { type: "array", items: ref("Category") }) },
      post: {
        tags: ["Admin"], summary: "Create a category", ...LOGGED_IN,
        requestBody: jsonBody(categorySchema),
        responses: { ...ok("Created", ref("Category"), { status: 201 }), ...errors(400, 401, 403, 409) }
      }
    },
    "/categories/{id}": {
      parameters: [pathId("id", "Category id")],
      get: { tags: ["Catalog"], summary: "Get a category", ...PUBLIC, responses: { ...ok("Category", ref("Category")), ...errors(404) } },
      put: {
        tags: ["Admin"], summary: "Rename a category", ...LOGGED_IN,
        requestBody: jsonBody(categorySchema),
        responses: { ...ok("Updated", ref("Category")), ...errors(400, 401, 403, 404, 409) }
      },
      delete: {
        tags: ["Admin"], summary: "Delete a category", ...LOGGED_IN,
        description: "Refused with 409 while products still belong to it.",
        responses: { ...message("Deleted"), ...errors(401, 403, 404, 409) }
      }
    },
    "/products": {
      get: {
        tags: ["Catalog"], summary: "Search and list products", ...PUBLIC,
        description: "`search` matches words in the name and description in any form (\"lamps\" finds \"lamp\"), tolerates typos in the name (\"hedphones\"), and supports search-box syntax: `red mug`, `mug or cup`, `-plastic`, `\"exact phrase\"`. While searching, results come best match first unless another `sort` is chosen.",
        parameters: queryParams(productListQuerySchema),
        responses: { ...ok("A page of products", { type: "array", items: ref("Product") }, { pagination: true }), ...errors(400) }
      },
      post: {
        tags: ["Admin"], summary: "Create a product", ...LOGGED_IN,
        description: "The slug is generated from the name and never changes afterwards.",
        requestBody: jsonBody(productSchema),
        responses: { ...ok("Created", ref("Product"), { status: 201 }), ...errors(400, 401, 403) }
      }
    },
    "/products/slug/{slug}": {
      get: {
        tags: ["Catalog"], summary: "Get a product by its slug", ...PUBLIC,
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string", example: "ceramic-coffee-mug" } }],
        responses: { ...ok("Product", ref("Product")), ...errors(400, 404) }
      }
    },
    "/products/{id}": {
      parameters: [pathId("id", "Product id")],
      get: { tags: ["Catalog"], summary: "Get a product", ...PUBLIC, responses: { ...ok("Product", ref("Product")), ...errors(400, 404) } },
      put: {
        tags: ["Admin"], summary: "Replace a product's details", ...LOGGED_IN,
        description: "price and stock are optional here, and only accepted for a product with ONE variant (they belong to the variant). For a product with several, change each variant instead.",
        requestBody: jsonBody(productUpdateSchema),
        responses: { ...ok("Updated", ref("Product")), ...errors(400, 401, 403, 404, 409) }
      },
      delete: { tags: ["Admin"], summary: "Delete a product", ...LOGGED_IN, responses: { ...message("Deleted"), ...errors(401, 403, 404) } }
    },

    // ----- Reviews -----
    "/products/{id}/reviews": {
      parameters: [pathId("id", "Product id")],
      get: {
        tags: ["Reviews"], summary: "Reviews and rating summary", ...PUBLIC,
        parameters: queryParams(reviewListQuerySchema),
        responses: { ...ok("Reviews", ref("ReviewPage"), { pagination: true }), ...errors(400, 404) }
      },
      post: {
        tags: ["Reviews"], summary: "Review a product you've received", ...LOGGED_IN,
        description: "Only for products in one of your **delivered** orders. One review per product.",
        requestBody: jsonBody(createReviewSchema),
        responses: { ...ok("Review created", ref("Review"), { status: 201 }), ...errors(400, 401, 403, 404, 409) }
      }
    },
    "/products/{id}/reviews/me": {
      parameters: [pathId("id", "Product id")],
      patch: {
        tags: ["Reviews"], summary: "Edit my review", ...LOGGED_IN,
        requestBody: jsonBody(updateReviewSchema),
        responses: { ...ok("Updated", ref("Review")), ...errors(400, 401, 404) }
      },
      delete: { tags: ["Reviews"], summary: "Delete my review", ...LOGGED_IN, responses: { ...message("Deleted"), ...errors(401, 404) } }
    },
    "/products/{id}/variants": {
      parameters: [pathId("id", "Product id")],
      get: { tags: ["Catalog"], summary: "A product's variants (sizes, colours...)", ...PUBLIC, responses: { ...ok("Variants", { type: "array", items: ref("Variant") }), ...errors(404) } },
      post: {
        tags: ["Admin"], summary: "Add a variant", ...LOGGED_IN,
        description: "Every variant of a product must use the same option names (e.g. all `size` + `colour`). A product created with POST /products starts with one variant without options: PATCH it to give it options first.",
        requestBody: jsonBody(createVariantSchema),
        responses: { ...ok("Created", ref("Variant"), { status: 201 }), ...errors(400, 401, 403, 404, 409) }
      }
    },
    "/products/{id}/variants/{variantId}": {
      parameters: [pathId("id", "Product id"), pathId("variantId", "Variant id")],
      patch: {
        tags: ["Admin"], summary: "Change a variant (options, SKU, price, stock)", ...LOGGED_IN,
        requestBody: jsonBody(updateVariantSchema),
        responses: { ...ok("Updated", ref("Variant")), ...errors(400, 401, 403, 404, 409) }
      },
      delete: {
        tags: ["Admin"], summary: "Delete a variant", ...LOGGED_IN,
        description: "A product keeps at least one variant (409 for the last one). Past orders keep their snapshot.",
        responses: { ...message("Deleted"), ...errors(401, 403, 404, 409) }
      }
    },
    "/products/{id}/image": {
      parameters: [pathId("id", "Product id")],
      patch: {
        tags: ["Admin"], summary: "Set or remove a product's image", ...LOGGED_IN,
        description: [
          "Step 3 of an image upload. `imageUrl` must be the `secure_url` Cloudinary returned for an upload",
          "made with `POST /admin/uploads/product-image`; send `null` to remove the image.",
          "The previous image is deleted from Cloudinary."
        ].join(" "),
        requestBody: jsonBody(productImageSchema),
        responses: { ...ok("Updated product", ref("Product")), ...errors(400, 401, 403, 404, 503) }
      }
    },
    "/admin/uploads/product-image": {
      post: {
        tags: ["Admin"], summary: "Get permission to upload one product image", ...LOGGED_IN,
        description: [
          "Step 1 of an image upload. Then (step 2) the browser POSTs the file to `uploadUrl` as `multipart/form-data`,",
          "with every entry of `fields` as a form field plus `file`. Cloudinary answers with `secure_url`,",
          "which you send to `PATCH /products/{id}/image` (step 3). The file never passes through this API."
        ].join(" "),
        responses: { ...ok("Signed upload permission", ref("ImageUpload")), ...errors(401, 403, 503) }
      }
    },
    "/admin/coupons": {
      get: {
        tags: ["Admin"], summary: "List coupons (newest first)", ...LOGGED_IN,
        parameters: queryParams(couponListQuerySchema),
        responses: { ...ok("A page of coupons", { type: "array", items: ref("Coupon") }, { pagination: true }), ...errors(400, 401, 403) }
      },
      post: {
        tags: ["Admin"], summary: "Create a coupon", ...LOGGED_IN,
        description: "percent: `discountValue` 1-100, optionally capped by `maxDiscount`. fixed: `discountValue` rupees off. A discount never brings an order below ₹1. By default each customer can use a coupon once (`perUserLimit`; null = unlimited).",
        requestBody: jsonBody(createCouponSchema),
        responses: { ...ok("Created", ref("Coupon"), { status: 201 }), ...errors(400, 401, 403, 409) }
      }
    },
    "/admin/coupons/{id}": {
      parameters: [pathId("id", "Coupon id")],
      get: { tags: ["Admin"], summary: "Get a coupon", ...LOGGED_IN, responses: { ...ok("Coupon", ref("Coupon")), ...errors(401, 403, 404) } },
      patch: {
        tags: ["Admin"], summary: "Change a coupon (send only what changes; null clears a limit)", ...LOGGED_IN,
        requestBody: jsonBody(updateCouponSchema),
        responses: { ...ok("Updated", ref("Coupon")), ...errors(400, 401, 403, 404, 409) }
      },
      delete: {
        tags: ["Admin"], summary: "Delete a coupon nobody has used", ...LOGGED_IN,
        description: "409 once it has been used: set `isActive` to false instead.",
        responses: { ...message("Deleted"), ...errors(401, 403, 404, 409) }
      }
    },
    "/admin/stock-movements": {
      get: {
        tags: ["Admin"], summary: "The stock ledger: every stock change, newest first", ...LOGGED_IN,
        description: "Every change is recorded by the database itself, whatever caused it: checkout (`order_placed`), cancellation (`order_cancelled`), admin edits (`initial`, `correction`), adjustments below, or SQL run by hand (`manual`).",
        parameters: queryParams(stockMovementListQuerySchema),
        responses: { ...ok("A page of movements", { type: "array", items: ref("StockMovement") }, { pagination: true }), ...errors(400, 401, 403) }
      },
      post: {
        tags: ["Admin"], summary: "Adjust a variant's stock, with a reason", ...LOGGED_IN,
        description: "Send the CHANGE (+10 arrived, -2 broken), not a new total: a sale happening at the same moment is never overwritten. restock/returned must be positive, damaged negative.",
        requestBody: jsonBody(stockAdjustmentSchema),
        responses: { ...ok("Recorded", ref("StockMovement"), { status: 201 }), ...errors(400, 401, 403, 404, 409) }
      }
    },
    "/admin/reports/summary": {
      get: {
        tags: ["Reports"], summary: "Revenue, orders, units, discounts and average order value vs the previous period", ...LOGGED_IN,
        description: REPORT_NOTES,
        parameters: queryParams(summaryQuerySchema),
        responses: { ...ok("Summary", ref("SalesSummary")), ...errors(400, 401, 403) }
      }
    },
    "/admin/reports/revenue": {
      get: {
        tags: ["Reports"], summary: "Revenue over time (every day/week/month, quiet ones as 0)", ...LOGGED_IN,
        description: `${REPORT_NOTES} Each point has a running total, the change vs the previous point, and a moving average over the last 7 points. Weeks run Monday-Sunday. Daily series: at most 731 days.`,
        parameters: queryParams(revenueQuerySchema),
        responses: { ...ok("Series", ref("RevenueSeries")), ...errors(400, 401, 403) }
      }
    },
    "/admin/reports/top-products": {
      get: {
        tags: ["Reports"], summary: "Best sellers, ranked by revenue or units", ...LOGGED_IN,
        description: "Live numbers. Revenue here is before order-level coupon discounts. Equal values share a rank (1, 2, 2, 4).",
        parameters: queryParams(topProductsQuerySchema),
        responses: { ...ok("Top products", ref("TopProducts")), ...errors(400, 401, 403) }
      }
    },
    "/admin/reports/customers": {
      get: {
        tags: ["Reports"], summary: "New vs returning customers, top customers", ...LOGGED_IN,
        description: "Live numbers. A new customer's first order ever falls in the range; a returning one had ordered before it.",
        parameters: queryParams(customersQuerySchema),
        responses: { ...ok("Customer report", ref("CustomerReport")), ...errors(400, 401, 403) }
      }
    },
    "/admin/reports/refresh": {
      post: {
        tags: ["Reports"], summary: "Recalculate the daily sales numbers now", ...LOGGED_IN,
        description: "Normally done every 10 minutes by a background job.",
        responses: { ...ok("Refreshed", { type: "object", properties: { refreshedAt: { type: "string", format: "date-time" } } }), ...errors(401, 403) }
      }
    },
    "/admin/reviews/{id}": {
      parameters: [pathId("id", "Review id")],
      delete: { tags: ["Admin"], summary: "Remove any review", ...LOGGED_IN, responses: { ...message("Deleted"), ...errors(401, 403, 404) } }
    },

    // ----- Cart -----
    "/cart": {
      get: {
        tags: ["Cart"], summary: "My cart with totals", ...LOGGED_IN,
        description: "Add `?coupon=CODE` to see what a coupon would save (`coupon`, `discount`, `total`). Nothing is reserved: the coupon is checked again at checkout. A coupon that can't be used gives 404 (no such coupon) or 409 with the reason.",
        parameters: queryParams(cartQuerySchema),
        responses: { ...ok("Cart", ref("Cart")), ...errors(400, 401, 404, 409) }
      },
      delete: { tags: ["Cart"], summary: "Empty my cart", ...LOGGED_IN, responses: { ...ok("Empty cart", ref("Cart")), ...errors(401) } }
    },
    "/cart/items": {
      post: {
        tags: ["Cart"], summary: "Add a product (or more of it)", ...LOGGED_IN,
        parameters: [IDEMPOTENCY_KEY],
        description: `Send variantId to choose an option (size, colour...); it can be left out for a product with only one variant. Adding a variant that's already in the cart raises its quantity. At most ${MAX_QUANTITY_PER_ITEM} of one product, and never more than the stock.`,
        requestBody: jsonBody(addCartItemSchema),
        responses: { ...ok("Updated cart", ref("Cart")), ...errors(400, 401, 404, 409, 422) }
      }
    },
    "/cart/items/{id}": {
      parameters: [pathId("id", "The cart line's variantId (or the productId, if your cart has only one option of that product)")],
      patch: {
        tags: ["Cart"], summary: "Set a product's quantity", ...LOGGED_IN,
        requestBody: jsonBody(updateCartItemSchema),
        responses: { ...ok("Updated cart", ref("Cart")), ...errors(400, 401, 404, 409) }
      },
      delete: { tags: ["Cart"], summary: "Remove a product", ...LOGGED_IN, responses: { ...ok("Updated cart", ref("Cart")), ...errors(401, 404) } }
    },

    // ----- Wishlist -----
    "/wishlist": {
      get: { tags: ["Cart"], summary: "My wishlist (newest first)", ...LOGGED_IN, responses: { ...ok("Wishlist", { type: "array", items: ref("WishlistItem") }), ...errors(401) } }
    },
    "/wishlist/{productId}": {
      parameters: [pathId("productId", "Product id")],
      put: {
        tags: ["Cart"], summary: "Save a product to my wishlist", ...LOGGED_IN,
        description: "Saving a product that's already saved changes nothing (safe to repeat). At most 200 products.",
        responses: { ...ok("Wishlist", { type: "array", items: ref("WishlistItem") }), ...errors(400, 401, 404, 409) }
      },
      delete: { tags: ["Cart"], summary: "Remove a product from my wishlist", ...LOGGED_IN, responses: { ...ok("Wishlist", { type: "array", items: ref("WishlistItem") }), ...errors(400, 401, 404) } }
    },

    // ----- Addresses -----
    "/addresses": {
      get: { tags: ["Addresses"], summary: "My addresses (default first)", ...LOGGED_IN, responses: { ...ok("Addresses", { type: "array", items: ref("Address") }), ...errors(401) } },
      post: {
        tags: ["Addresses"], summary: "Add an address", ...LOGGED_IN,
        description: "Your first address becomes the default. Indian PIN codes must be 6 digits.",
        requestBody: jsonBody(createAddressSchema),
        responses: { ...ok("Created", ref("Address"), { status: 201 }), ...errors(400, 401) }
      }
    },
    "/addresses/{id}": {
      parameters: [pathId("id", "Address id")],
      patch: {
        tags: ["Addresses"], summary: "Change some fields", ...LOGGED_IN,
        requestBody: jsonBody(updateAddressSchema),
        responses: { ...ok("Updated", ref("Address")), ...errors(400, 401, 404) }
      },
      delete: { tags: ["Addresses"], summary: "Delete an address", ...LOGGED_IN, responses: { ...message("Deleted"), ...errors(401, 404) } }
    },

    // ----- Orders -----
    "/orders": {
      post: {
        tags: ["Orders"], summary: "Checkout: turn my cart into an order", ...LOGGED_IN,
        parameters: [IDEMPOTENCY_KEY],
        description: "Leave out `addressId` to ship to your default address. Send `couponCode` for a discount (404/409 if it can't be used). Stock is reserved now; the order starts as `pending` and must be paid by `expiresAt` (3 days by default; set ORDER_PAYMENT_TIMEOUT_MINUTES to change it), or it's cancelled automatically and the stock released.",
        requestBody: { ...jsonBody(checkoutSchema), required: false },
        responses: { ...ok("Order placed", ref("Order"), { status: 201 }), ...errors(400, 401, 404, 409, 422) }
      },
      get: {
        tags: ["Orders"], summary: "My orders (newest first)", ...LOGGED_IN,
        parameters: queryParams(orderListQuerySchema),
        responses: { ...ok("A page of orders", { type: "array", items: ref("OrderSummary") }, { pagination: true }), ...errors(400, 401) }
      }
    },
    "/orders/number/{orderNumber}": {
      get: {
        tags: ["Orders"], summary: "One of my orders, by its order number", ...LOGGED_IN,
        description: "Accepts `ORD-7K3M9Q`, `ord-7k3m9q` or just `7K3M9Q`.",
        parameters: [{ name: "orderNumber", in: "path", required: true, schema: { ...orderNumberSchema, example: "ORD-7K3M9Q" } }],
        responses: { ...ok("Order", ref("Order")), ...errors(400, 401, 404) }
      }
    },
    "/orders/{id}": {
      parameters: [pathId("id", "Order id")],
      get: { tags: ["Orders"], summary: "One of my orders", ...LOGGED_IN, responses: { ...ok("Order", ref("Order")), ...errors(401, 404) } }
    },
    "/orders/{id}/cancel": {
      parameters: [pathId("id", "Order id")],
      post: {
        tags: ["Orders"], summary: "Cancel my pending order", ...LOGGED_IN,
        description: "Only while `pending`. The items go back into stock.",
        responses: { ...ok("Cancelled order", ref("Order")), ...errors(401, 404, 409) }
      }
    },
    "/orders/{id}/payment": {
      parameters: [pathId("id", "Order id")],
      post: {
        tags: ["Orders"], summary: "Start paying with Razorpay", ...LOGGED_IN,
        description: "Returns what Razorpay Checkout needs in the browser. Repeated calls reuse the same Razorpay order.",
        responses: { ...ok("Checkout details", ref("PaymentStart")), ...errors(401, 404, 409, 502, 503) }
      }
    },
    "/orders/{id}/payment/verify": {
      parameters: [pathId("id", "Order id")],
      post: {
        tags: ["Orders"], summary: "Confirm a payment from Razorpay Checkout", ...LOGGED_IN,
        description: "Send the three values Razorpay Checkout returns. The signature is checked on the server.",
        requestBody: jsonBody(verifyPaymentSchema),
        responses: { ...ok("Paid order", ref("Order")), ...errors(400, 401, 404, 409, 503) }
      }
    },

    // ----- Admin -----
    "/users": {
      get: { tags: ["Admin"], summary: "List all users", ...LOGGED_IN, responses: { ...ok("Users", { type: "array", items: ref("User") }), ...errors(401, 403) } }
    },
    "/users/{id}/role": {
      parameters: [pathId("id", "User id")],
      patch: {
        tags: ["Admin"], summary: "Make someone an admin, or a regular user again", ...LOGGED_IN,
        description: "409 for your own role, or for removing the last admin. Takes effect on the user's next request. Recorded in the audit log.",
        requestBody: jsonBody(roleSchema),
        responses: { ...ok("Updated", ref("User")), ...errors(400, 401, 403, 404, 409) }
      }
    },
    "/admin/audit-log": {
      get: {
        tags: ["Admin"], summary: "Who changed what, and when (newest first)", ...LOGGED_IN,
        description: "Recorded by the database itself for products, variants, categories, coupons, order changes and user changes, however they happen. Read-only, also for the database (append-only). Stock changes are in /admin/stock-movements; passwords show only as [redacted].",
        parameters: queryParams(auditLogQuerySchema),
        responses: { ...ok("A page of entries", { type: "array", items: ref("AuditEntry") }, { pagination: true }), ...errors(400, 401, 403) }
      }
    },
    "/admin/orders": {
      get: {
        tags: ["Admin"], summary: "All orders, with customer details", ...LOGGED_IN,
        parameters: queryParams(adminOrderListQuerySchema),
        responses: { ...ok("A page of orders", { type: "array", items: ref("OrderSummary") }, { pagination: true }), ...errors(400, 401, 403) }
      }
    },
    "/admin/orders/{id}": {
      parameters: [pathId("id", "Order id")],
      get: { tags: ["Admin"], summary: "Any order", ...LOGGED_IN, responses: { ...ok("Order", ref("Order")), ...errors(401, 403, 404) } }
    },
    "/admin/orders/{id}/status": {
      parameters: [pathId("id", "Order id")],
      patch: {
        tags: ["Admin"], summary: "Move an order to its next status", ...LOGGED_IN,
        description: "Allowed: pending → paid / cancelled, paid → shipped / cancelled, shipped → delivered. Cancelling restores stock; cancelling a PAID order also refunds the customer through Razorpay automatically.",
        requestBody: jsonBody(updateOrderStatusSchema),
        responses: { ...ok("Updated order", ref("Order")), ...errors(400, 401, 403, 404, 409) }
      }
    },

    // ----- Webhooks -----
    "/webhooks/razorpay": {
      post: {
        tags: ["Webhooks"], summary: "Razorpay payment events", ...PUBLIC,
        description: "Signed by Razorpay with the webhook secret (`X-Razorpay-Signature`). Handles `payment.captured`, `order.paid`, `payment.failed`, and `refund.created` / `refund.processed` / `refund.failed`; each event id is processed once.",
        parameters: [
          { name: "X-Razorpay-Signature", in: "header", required: true, schema: { type: "string" } },
          { name: "X-Razorpay-Event-Id", in: "header", required: false, schema: { type: "string" } }
        ],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { 200: { description: "Received" }, ...errors(400, 503) }
      }
    }
  },

  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "The token from POST /auth/login" }
    },

    responses: {
      400: { description: "Invalid request (see `errors`)", content: { "application/json": { schema: ref("ValidationError") } } },
      401: { description: "Not logged in, or the session has ended", content: { "application/json": { schema: ref("Error") } } },
      403: { description: "Logged in, but not allowed", content: { "application/json": { schema: ref("Error") } } },
      404: { description: "Not found (or not yours)", content: { "application/json": { schema: ref("Error") } } },
      409: { description: "Conflicts with the current state (stock, status, duplicates, or a request with the same Idempotency-Key still running)", content: { "application/json": { schema: ref("ValidationError") } } },
      422: { description: "This Idempotency-Key was already used for a different request", content: { "application/json": { schema: ref("Error") } } },
      429: { description: "Too many requests. See the `Retry-After` header", content: { "application/json": { schema: ref("Error") } } },
      502: { description: "The payment provider couldn't be reached", content: { "application/json": { schema: ref("Error") } } },
      503: { description: "Payments are not configured on this server", content: { "application/json": { schema: ref("Error") } } }
    },

    schemas: {
      Error: {
        type: "object",
        properties: { success: { const: false }, message: { type: "string" }, requestId: { type: "string", description: "Only on 500 errors" } },
        required: ["success", "message"]
      },
      ValidationError: {
        type: "object",
        properties: {
          success: { const: false },
          message: { type: "string", example: "Validation failed" },
          errors: {
            type: "array",
            items: { type: "object", properties: { field: { type: "string" }, message: { type: "string" } } }
          }
        },
        required: ["success", "message"]
      },
      Pagination: {
        type: "object",
        description: "Products, orders and the stock ledger can also be paged with a cursor: send the `nextCursor` you got back as `?cursor=` (instead of `page`) to get the following page. Cursor pages are fast at any depth and never skip or repeat items when new ones arrive; they have no `page`/`total`/`totalPages`. `nextCursor` is null on the last page.",
        properties: {
          page: { type: "integer", description: "Page-number paging only" },
          limit: { type: "integer" },
          total: { type: "integer", description: "Page-number paging only" },
          totalPages: { type: "integer", description: "Page-number paging only" },
          nextCursor: { type: ["string", "null"], description: "Pass as ?cursor= for the next page (lists that support cursors)" }
        }
      },
      User: {
        type: "object",
        properties: {
          id: UUID, name: { type: "string" }, email: { type: "string", format: "email" },
          role: { type: "string", enum: ["user", "admin"] }, created_at: { type: "string", format: "date-time" },
          email_verified: { type: "boolean", description: "Has the user clicked the link in the verification email?" }
        }
      },
      AuthResult: {
        type: "object",
        properties: {
          user: ref("User"),
          token: { type: "string", description: "The access token. Send as `Authorization: Bearer <token>`; get a new one from POST /auth/refresh before it expires" },
          accessTokenExpiresIn: { type: "string", example: "15m" }
        }
      },
      TwoFactorChallenge: {
        type: "object",
        properties: {
          twoFactorRequired: { const: true },
          challengeToken: { type: "string", description: "Send with a code to POST /auth/login/2fa (valid 5 minutes)" }
        }
      },
      WishlistItem: {
        type: "object",
        properties: {
          productId: UUID, slug: { type: "string" }, name: { type: "string" },
          price: { type: "integer", description: "Today's lowest price" }, inStock: { type: "boolean" },
          thumbnailUrl: { type: ["string", "null"] },
          rating: { type: "object", properties: { average: { type: "number" }, count: { type: "integer" } } },
          addedAt: { type: "string", format: "date-time" }
        }
      },
      StockMovement: {
        type: "object",
        properties: {
          id: UUID,
          productId: { type: ["string", "null"], format: "uuid" },
          variantId: { type: ["string", "null"], format: "uuid" },
          productName: { type: ["string", "null"], description: "null if the product was deleted since" },
          optionsLabel: { type: ["string", "null"] }, sku: { type: ["string", "null"] },
          change: { type: "integer", example: -2 },
          stockAfter: { type: "integer", description: "The variant's stock right after this movement" },
          reason: { type: "string", enum: ["initial", "restock", "damaged", "returned", "correction", "order_placed", "order_cancelled", "manual"] },
          note: { type: ["string", "null"] },
          order: { type: ["object", "null"], properties: { id: UUID, orderNumber: { type: "string" } } },
          by: { type: ["object", "null"], properties: { id: UUID, name: { type: "string" } } },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      AuditEntry: {
        type: "object",
        properties: {
          id: UUID,
          table: { type: "string", example: "product_variants" },
          recordId: UUID,
          action: { type: "string", enum: ["insert", "update", "delete"] },
          changes: { type: "object", description: "update: { column: [old, new] } for what changed. insert/delete: the whole row.", example: { price: [999, 799] } },
          actor: { type: ["object", "null"], description: "null when no logged-in person did it: see source", properties: { id: UUID, name: { type: "string" }, email: { type: "string" } } },
          source: { type: "string", description: "api, job:<name>, script:<name>, or database (SQL run by hand)", example: "api" },
          requestId: { type: ["string", "null"], description: "Matches the request id in the server logs" },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      SalesSummary: {
        type: "object",
        properties: {
          from: DAY, to: DAY,
          previousPeriod: { type: "object", properties: { from: DAY, to: DAY } },
          revenue: ref("Metric"), orders: ref("Metric"), unitsSold: ref("Metric"), discounts: ref("Metric"), averageOrderValue: ref("Metric"),
          dataAsOf: DATA_AS_OF
        }
      },
      Metric: {
        type: "object",
        properties: {
          value: { type: "integer" }, previous: { type: "integer" },
          changePercent: { type: ["number", "null"], description: "+25.5 = 25.5% more than the previous period; null if the previous was 0" }
        }
      },
      RevenueSeries: {
        type: "object",
        properties: {
          from: DAY, to: DAY, interval: { type: "string", enum: ["day", "week", "month"] },
          points: {
            type: "array",
            items: {
              type: "object",
              properties: {
                period: { ...DAY, description: "The day, or the first day of the week/month" },
                revenue: { type: "integer" }, orders: { type: "integer" }, unitsSold: { type: "integer" },
                runningRevenue: { type: "integer", description: "Total from the first point up to this one" },
                changePercent: { type: ["number", "null"] },
                movingAverage: { type: "integer", description: "Average revenue of this point and the 6 before it" }
              }
            }
          },
          dataAsOf: DATA_AS_OF
        }
      },
      TopProducts: {
        type: "object",
        properties: {
          from: DAY, to: DAY, by: { type: "string", enum: ["revenue", "units"] },
          products: {
            type: "array",
            items: {
              type: "object",
              properties: {
                rank: { type: "integer" }, productId: { type: ["string", "null"], format: "uuid" }, name: { type: "string" },
                unitsSold: { type: "integer" }, revenue: { type: "integer" }, revenueSharePercent: { type: "number" }, orders: { type: "integer" }
              }
            }
          }
        }
      },
      CustomerReport: {
        type: "object",
        properties: {
          from: DAY, to: DAY,
          customers: { type: "integer" }, newCustomers: { type: "integer" }, returningCustomers: { type: "integer" },
          returningPercent: { type: ["number", "null"] }, orders: { type: "integer" }, repeatOrders: { type: "integer" },
          averageDaysBetweenOrders: { type: ["number", "null"] },
          topCustomers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                rank: { type: "integer" }, userId: UUID, name: { type: "string" }, email: { type: "string" },
                orders: { type: "integer" }, spent: { type: "integer" }
              }
            }
          }
        }
      },
      Coupon: {
        type: "object",
        properties: {
          id: UUID,
          code: { type: "string", example: "WELCOME10" },
          description: { type: "string" },
          discountType: { type: "string", enum: ["percent", "fixed"] },
          discountValue: { type: "integer" },
          minOrderAmount: { type: "integer" },
          maxDiscount: { type: ["integer", "null"] },
          startsAt: { type: ["string", "null"], format: "date-time" },
          expiresAt: { type: ["string", "null"], format: "date-time" },
          usageLimit: { type: ["integer", "null"] },
          perUserLimit: { type: ["integer", "null"] },
          timesUsed: { type: "integer", description: "Orders using it now (a cancelled order gives its use back)" },
          isActive: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        }
      },
      Variant: {
        type: "object",
        properties: {
          id: UUID,
          options: { type: "object", additionalProperties: { type: "string" }, example: { size: "M", colour: "Blue" } },
          label: { type: "string", example: "Size: M, Colour: Blue", description: "Empty for a product without options" },
          sku: { type: ["string", "null"], example: "TEE-M-BLU" },
          price: { type: "integer", description: "Whole rupees" },
          stock: { type: "integer" }
        }
      },
      Category: { type: "object", properties: { id: UUID, name: { type: "string" } } },
      Product: {
        type: "object",
        properties: {
          id: UUID,
          slug: { type: "string", example: "ceramic-coffee-mug" },
          name: { type: "string" },
          description: { type: "string" },
          price: { type: "integer", description: "The LOWEST variant price, in whole rupees (\"from ₹349\")", example: 349 },
          stock: { type: "integer", description: "Total stock across all variants" },
          variantCount: { type: "integer" },
          variants: { type: "array", items: ref("Variant"), description: "Single product only (GET /products/{id} or /slug/{slug}), not in lists" },
          imageUrl: { type: ["string", "null"], description: "The original image" },
          thumbnailUrl: { type: ["string", "null"], description: "400×400, automatic format and quality (for lists)" },
          rating: { type: "object", properties: { average: { type: "number", example: 4.5 }, count: { type: "integer" } } },
          category: { anyOf: [ref("Category"), { type: "null" }] }
        }
      },
      ImageUpload: {
        type: "object",
        properties: {
          uploadUrl: { type: "string", example: "https://api.cloudinary.com/v1_1/your-cloud/image/upload" },
          fields: {
            type: "object",
            description: "Send each of these as a form field, together with `file`",
            properties: {
              public_id: { type: "string", example: "ecommerce/products/2f0c6a52-…" },
              allowed_formats: { type: "string", example: "jpg,png,webp" },
              timestamp: { type: "integer" },
              api_key: { type: "string" },
              signature: { type: "string" }
            }
          },
          expiresAt: { type: "string", format: "date-time" }
        }
      },
      Cart: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: UUID, variantId: UUID, slug: { type: "string" }, name: { type: "string" },
                options: { type: "object", additionalProperties: { type: "string" } }, optionsLabel: { type: "string" },
                price: { type: "integer" }, imageUrl: { type: ["string", "null"] }, stock: { type: "integer" },
                quantity: { type: "integer" }, lineTotal: { type: "integer" }
              }
            }
          },
          totalQuantity: { type: "integer" },
          subtotal: { type: "integer" },
          coupon: {
            type: ["object", "null"], description: "Only with ?coupon=CODE",
            properties: { code: { type: "string" }, description: { type: "string" }, discount: { type: "integer" } }
          },
          discount: { type: "integer" },
          total: { type: "integer", description: "subtotal - discount" }
        }
      },
      Address: {
        type: "object",
        properties: {
          id: UUID, label: { type: ["string", "null"] }, fullName: { type: "string" }, phone: { type: "string" },
          line1: { type: "string" }, line2: { type: ["string", "null"] }, city: { type: "string" }, state: { type: "string" },
          postalCode: { type: "string" }, country: { type: "string", example: "IN" }, isDefault: { type: "boolean" }
        }
      },
      OrderSummary: {
        type: "object",
        properties: {
          id: UUID,
          orderNumber: { type: "string", example: "ORD-7K3M9Q", description: "Short, random, easy to read out (no 0/O, 1/I/L, U)" }, status: { type: "string", enum: ORDER_STATUSES }, totalAmount: { type: "integer" },
          itemCount: { type: "integer" }, createdAt: { type: "string", format: "date-time" },
          customer: { type: "object", description: "Admin lists only", properties: { id: UUID, name: { type: "string" }, email: { type: "string" } } }
        }
      },
      Order: {
        type: "object",
        properties: {
          id: UUID,
          orderNumber: { type: "string", example: "ORD-7K3M9Q", description: "Short, random, easy to read out (no 0/O, 1/I/L, U)" },
          status: { type: "string", enum: ORDER_STATUSES },
          subtotalAmount: { type: "integer", description: "The items, in whole rupees" },
          discountAmount: { type: "integer", description: "Taken off by the coupon (0 without one)" },
          couponCode: { type: ["string", "null"], example: "WELCOME10" },
          totalAmount: { type: "integer", description: "What is paid: subtotalAmount - discountAmount" },
          createdAt: { type: "string", format: "date-time" },
          expiresAt: {
            type: ["string", "null"], format: "date-time",
            description: "Pending orders only: pay before this time, or the order is cancelled and its stock released"
          },
          cancelReason: { type: ["string", "null"], enum: ["customer", "admin", "payment_timeout", null] },
          refund: {
            description: "The latest refund, if the order was paid and then cancelled (sent to Razorpay automatically)",
            anyOf: [
              {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["pending", "processed", "failed"] },
                  amount: { type: "integer", description: "Whole rupees" },
                  requestedAt: { type: "string", format: "date-time" }
                }
              },
              { type: "null" }
            ]
          },
          updatedAt: { type: "string", format: "date-time" },
          shippingAddress: { description: "A copy of the address at checkout time", anyOf: [{ type: "object" }, { type: "null" }] },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: { type: ["string", "null"], format: "uuid", description: "null if the product was deleted later" },
                variantId: { type: ["string", "null"], format: "uuid" },
                productName: { type: "string" },
                options: { type: "object", additionalProperties: { type: "string" }, description: "The options chosen, as they were when ordered" },
                optionsLabel: { type: "string" }, sku: { type: ["string", "null"] },
                unitPrice: { type: "integer" }, quantity: { type: "integer" }, lineTotal: { type: "integer" }
              }
            }
          }
        }
      },
      PaymentStart: {
        type: "object",
        properties: {
          orderId: UUID,
          keyId: { type: "string", description: "Razorpay key id (public)" },
          razorpayOrderId: { type: "string", example: "order_Nx8abc" },
          amount: { type: "integer", description: "In paise", example: 79900 },
          currency: { type: "string", example: "INR" },
          prefill: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, contact: { type: "string" } } }
        }
      },
      Review: {
        type: "object",
        properties: {
          id: UUID, rating: { type: "integer", minimum: 1, maximum: 5 }, comment: { type: "string" },
          reviewer: { type: "string", example: "Riya S." },
          createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }
        }
      },
      ReviewPage: {
        type: "object",
        properties: {
          summary: {
            type: "object",
            properties: {
              average: { type: "number" }, count: { type: "integer" },
              breakdown: { type: "object", description: "Number of reviews per star", example: { 5: 3, 4: 1, 3: 0, 2: 0, 1: 0 } }
            }
          },
          reviews: { type: "array", items: ref("Review") }
        }
      }
    }
  }
};
