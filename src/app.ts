import express from "express";
import addressRoutes from "./routes/address.routes.ts";
import adminOrderRoutes from "./routes/admin-order.routes.ts";
import auditRoutes from "./routes/audit.routes.ts";
import authRoutes from "./routes/auth.routes.ts";
import cartRoutes from "./routes/cart.routes.ts";
import categoryRoutes from "./routes/category.routes.ts";
import couponRoutes from "./routes/coupon.routes.ts";
import docsRoutes from "./routes/docs.routes.ts";
import healthRoutes from "./routes/health.routes.ts";
import orderRoutes from "./routes/order.routes.ts";
import productRoutes from "./routes/product.routes.ts";
import reportRoutes from "./routes/report.routes.ts";
import stockRoutes from "./routes/stock.routes.ts";
import { adminReviewRoutes } from "./routes/review.routes.ts";
import toolsRoutes from "./routes/tools.routes.ts";
import uploadRoutes from "./routes/upload.routes.ts";
import userRoutes from "./routes/user.routes.ts";
import webhookRoutes from "./routes/webhook.routes.ts";
import wishlistRoutes from "./routes/wishlist.routes.ts";
import { env } from "./config/env.ts";
import { requestContext } from "./context/request-context.ts";
import { notFound, errorHandler } from "./middlewares/error.middleware.ts";
import { requestLogger } from "./middlewares/request-logger.middleware.ts";
import { securityHeaders, corsPolicy, apiLimiter } from "./middlewares/security.middleware.ts";

const app = express();

// Behind a proxy (like ngrok), req.ip would be the PROXY's address for everyone.
// This tells Express how many proxies to trust, so it reads the real client IP.
app.set("trust proxy", env.TRUST_PROXY);

// Health check first: the hosting platform calls it every few seconds, so it skips
// request logging (it would flood the logs) and rate limiting (it must never be blocked)
app.use("/health", healthRoutes);

// Then: give every request an id and log it when it finishes (even if it's blocked below)
app.use(requestLogger);

// Remember who's making this request (filled in by requireAuth), for the audit log
app.use(requestContext);

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
app.use("/admin/reports", reportRoutes);
app.use("/admin/audit-log", auditRoutes);
app.use("/admin/uploads", uploadRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
