import express from "express";
import addressRoutes from "./routes/address.routes.js";
import adminOrderRoutes from "./routes/admin-order.routes.js";
import authRoutes from "./routes/auth.routes.js";
import cartRoutes from "./routes/cart.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import couponRoutes from "./routes/coupon.routes.js";
import docsRoutes from "./routes/docs.routes.js";
import healthRoutes from "./routes/health.routes.js";
import orderRoutes from "./routes/order.routes.js";
import productRoutes from "./routes/product.routes.js";
import stockRoutes from "./routes/stock.routes.js";
import { adminReviewRoutes } from "./routes/review.routes.js";
import toolsRoutes from "./routes/tools.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import userRoutes from "./routes/user.routes.js";
import webhookRoutes from "./routes/webhook.routes.js";
import wishlistRoutes from "./routes/wishlist.routes.js";
import { env } from "./config/env.js";
import { notFound, errorHandler } from "./middlewares/error.middleware.js";
import { requestLogger } from "./middlewares/request-logger.middleware.js";
import { securityHeaders, corsPolicy, apiLimiter } from "./middlewares/security.middleware.js";

const app = express();

// Behind a proxy (like ngrok), req.ip would be the PROXY's address for everyone.
// This tells Express how many proxies to trust, so it reads the real client IP.
app.set("trust proxy", env.TRUST_PROXY);

// Health check first: the hosting platform calls it every few seconds, so it skips
// request logging (it would flood the logs) and rate limiting (it must never be blocked)
app.use("/health", healthRoutes);

// Then: give every request an id and log it when it finishes (even if it's blocked below)
app.use(requestLogger);

// Security next: these run for every request
app.use(securityHeaders);
app.use(corsPolicy);
app.use(apiLimiter);

// Webhooks come BEFORE express.json(): their signature is checked against the raw body bytes
app.use("/webhooks", webhookRoutes);

// Refuse JSON bodies bigger than 100 KB (nothing in this API needs more)
app.use(express.json({ limit: "100kb" }));

// Interactive API documentation
app.use("/docs", docsRoutes);

// Small browser tools for trying things out (development only), e.g. /tools/product-image.html
if (env.NODE_ENV !== "production") {
  app.use("/tools", toolsRoutes);
}

app.get("/", (req, res) => {
  res.json({
    message: "E-commerce API is running"
  });
});

app.use("/auth", authRoutes);
app.use("/categories", categoryRoutes);
app.use("/products", productRoutes);
app.use("/users", userRoutes);
app.use("/cart", cartRoutes);
app.use("/wishlist", wishlistRoutes);
app.use("/addresses", addressRoutes);
app.use("/orders", orderRoutes);
app.use("/admin/orders", adminOrderRoutes);
app.use("/admin/reviews", adminReviewRoutes);
app.use("/admin/coupons", couponRoutes);
app.use("/admin/stock-movements", stockRoutes);
app.use("/admin/uploads", uploadRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
