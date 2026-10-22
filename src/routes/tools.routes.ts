import path from "node:path";
import express, { Router } from "express";
import helmet from "helmet";

const router = Router();

// These pages need a slightly wider security policy than the rest of the API:
// they send files to Cloudinary and show images from other sites.
router.use(
  helmet.contentSecurityPolicy({
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "connect-src": ["'self'", "https://api.cloudinary.com"],
      "img-src": ["'self'", "data:", "blob:", "https:"]
    }
  })
);

// extensions: "/tools/reset-password" also finds reset-password.html (the email links use that)
router.use(express.static(path.join(import.meta.dirname, "../../public/tools"), { extensions: ["html"] }));

export default router;
