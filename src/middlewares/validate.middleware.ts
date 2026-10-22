import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";
import { AppError, type FieldError } from "../utils/app-error.ts";

// Which parts of the request can be checked, and with which zod schema
type Schemas = Partial<Record<"body" | "query" | "params", z.ZodType>>;

// Checks parts of the request against zod schemas before the controller runs.
// Usage: validate({ params: idParamSchema, body: productSchema, query: listQuerySchema })
export const validate = (schemas: Schemas) => (req: Request, res: Response, next: NextFunction): void => {

  const errors: FieldError[] = [];

  for (const [source, schema] of Object.entries(schemas) as Array<[keyof Schemas, z.ZodType]>) {
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
