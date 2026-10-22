import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiDocument } from "../docs/openapi.ts";

const router = Router();

// The raw description, for tools (Postman can import this URL, and so can code generators)
router.get("/openapi.json", (req, res) => {
  res.json(openApiDocument);
});

// The interactive page: read every endpoint and try it in the browser
router.use(
  "/",
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument, {
    customSiteTitle: "E-commerce API docs",
    swaggerOptions: {
      // Keep the token you pasted into "Authorize" after a page refresh
      persistAuthorization: true,
      displayRequestDuration: true
    }
  })
);

export default router;
