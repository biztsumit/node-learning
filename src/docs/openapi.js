// The OpenAPI description of this API, served at /docs (interactive) and /docs/openapi.json.
//
// Request bodies and query strings are generated FROM THE SAME ZOD SCHEMAS the routes use
// to validate, so the docs can't drift away from what the API really accepts.
import { z } from "zod";
import { MAX_QUANTITY_PER_ITEM, addCartItemSchema, updateCartItemSchema } from "../validators/cart.validators.js";
import { registerSchema, loginSchema, updateProfileSchema, changePasswordSchema } from "../validators/auth.validators.js";
import { categorySchema } from "../validators/category.validators.js";
import { productSchema, productListQuerySchema } from "../validators/product.validators.js";
import { createAddressSchema, updateAddressSchema } from "../validators/address.validators.js";
import { checkoutSchema, orderListQuerySchema, adminOrderListQuerySchema, updateOrderStatusSchema, orderNumberParamSchema } from "../validators/order.validators.js";
import { verifyPaymentSchema } from "../validators/payment.validators.js";
import { productImageSchema } from "../validators/upload.validators.js";
import { createReviewSchema, updateReviewSchema, reviewListQuerySchema } from "../validators/review.validators.js";
import { ORDER_STATUSES } from "../utils/order-status.js";

// Every id in this API is a UUID (time-ordered UUIDv7)
const UUID = { type: "string", format: "uuid", example: "01a14386-1238-7b41-9618-7ff4c0a7b55d" };

// ---------- Turning zod schemas into OpenAPI pieces ----------

// "input" = describe what the CLIENT sends (fields with defaults are optional)
const fromZod = (schema) => {
  const { $schema, ...jsonSchema } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  return jsonSchema;
};

const jsonBody = (schema) => ({
  required: true,
  content: { "application/json": { schema: fromZod(schema) } }
});

// One OpenAPI "parameter" per field of a query-string schema
const queryParams = (schema) => {
  const { properties, required = [] } = fromZod(schema);
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

const pathId = (name = "id", description) => ({
  name,
  in: "path",
  required: true,
  description,
  schema: UUID
});

// ---------- Responses ----------

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

// { success: true, data: ... }
const ok = (description, data, { status = 200, pagination = false } = {}) => ({
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

const message = (description) => ok(description, undefined);

// Error responses shared by many routes
const errors = (...codes) => Object.fromEntries(codes.map((code) => [code, { $ref: `#/components/responses/${code}` }]));

const PUBLIC = { security: [] };
const LOGGED_IN = { security: [{ bearerAuth: [] }] };

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
        description: "Only failed attempts count towards the rate limit.",
        requestBody: jsonBody(loginSchema),
        responses: { ...ok("Logged in", ref("AuthResult")), ...errors(400, 401, 429) }
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
    "/auth/logout-all": {
      post: { tags: ["Auth"], summary: "Log out on every device", ...LOGGED_IN, responses: { ...message("Logged out everywhere"), ...errors(401) } }
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
        requestBody: jsonBody(productSchema),
        responses: { ...ok("Updated", ref("Product")), ...errors(400, 401, 403, 404) }
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
    "/admin/reviews/{id}": {
      parameters: [pathId("id", "Review id")],
      delete: { tags: ["Admin"], summary: "Remove any review", ...LOGGED_IN, responses: { ...message("Deleted"), ...errors(401, 403, 404) } }
    },

    // ----- Cart -----
    "/cart": {
      get: { tags: ["Cart"], summary: "My cart with totals", ...LOGGED_IN, responses: { ...ok("Cart", ref("Cart")), ...errors(401) } },
      delete: { tags: ["Cart"], summary: "Empty my cart", ...LOGGED_IN, responses: { ...ok("Empty cart", ref("Cart")), ...errors(401) } }
    },
    "/cart/items": {
      post: {
        tags: ["Cart"], summary: "Add a product (or more of it)", ...LOGGED_IN,
        parameters: [IDEMPOTENCY_KEY],
        description: `Adding a product that's already in the cart raises its quantity. At most ${MAX_QUANTITY_PER_ITEM} of one product, and never more than the stock.`,
        requestBody: jsonBody(addCartItemSchema),
        responses: { ...ok("Updated cart", ref("Cart")), ...errors(400, 401, 404, 409, 422) }
      }
    },
    "/cart/items/{productId}": {
      parameters: [pathId("productId", "Product id")],
      patch: {
        tags: ["Cart"], summary: "Set a product's quantity", ...LOGGED_IN,
        requestBody: jsonBody(updateCartItemSchema),
        responses: { ...ok("Updated cart", ref("Cart")), ...errors(400, 401, 404, 409) }
      },
      delete: { tags: ["Cart"], summary: "Remove a product", ...LOGGED_IN, responses: { ...ok("Updated cart", ref("Cart")), ...errors(401, 404) } }
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
        description: "Leave out `addressId` to ship to your default address. Stock is reserved now; the order starts as `pending` and must be paid by `expiresAt` (3 days by default; set ORDER_PAYMENT_TIMEOUT_MINUTES to change it), or it's cancelled automatically and the stock released.",
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
        parameters: [{ name: "orderNumber", in: "path", required: true, schema: { ...fromZod(orderNumberParamSchema).properties.orderNumber, example: "ORD-7K3M9Q" } }],
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
        properties: { page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } }
      },
      User: {
        type: "object",
        properties: {
          id: UUID, name: { type: "string" }, email: { type: "string", format: "email" },
          role: { type: "string", enum: ["user", "admin"] }, created_at: { type: "string", format: "date-time" }
        }
      },
      AuthResult: {
        type: "object",
        properties: { user: ref("User"), token: { type: "string", description: "Send as `Authorization: Bearer <token>`" } }
      },
      Category: { type: "object", properties: { id: UUID, name: { type: "string" } } },
      Product: {
        type: "object",
        properties: {
          id: UUID,
          slug: { type: "string", example: "ceramic-coffee-mug" },
          name: { type: "string" },
          description: { type: "string" },
          price: { type: "integer", description: "Whole rupees", example: 349 },
          stock: { type: "integer" },
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
                productId: UUID, slug: { type: "string" }, name: { type: "string" },
                price: { type: "integer" }, imageUrl: { type: ["string", "null"] }, stock: { type: "integer" },
                quantity: { type: "integer" }, lineTotal: { type: "integer" }
              }
            }
          },
          totalQuantity: { type: "integer" },
          subtotal: { type: "integer" }
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
          totalAmount: { type: "integer", description: "Whole rupees" },
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
                productName: { type: "string" }, unitPrice: { type: "integer" }, quantity: { type: "integer" }, lineTotal: { type: "integer" }
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
