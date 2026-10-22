import { AppError } from "../utils/app-error.ts";

// Checks parts of the request against zod schemas before the controller runs.
// Usage: validate({ params: idParamSchema, body: productSchema, query: listQuerySchema })
export const validate = (schemas) => (req, res, next) => {

  const errors = [];

  for (const [source, schema] of Object.entries(schemas)) {
    const result = schema.safeParse(req[source] ?? {});

    if (result.success) {
      // Replace with the cleaned data (trimmed strings, numbers instead of "5", unknown fields removed).
      // defineProperty instead of "=": in Express 5, req.query can't be assigned to directly.
      Object.defineProperty(req, source, {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true
      });
    } else {
      for (const issue of result.error.issues) {
        errors.push({
          field: issue.path.join(".") || source,
          message: issue.message
        });
      }
    }
  }

  if (errors.length > 0) {
    throw new AppError(400, "Validation failed", errors);
  }

  next();
};
