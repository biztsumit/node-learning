import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/app-error.ts";

// Errors from Express's own body parsing (express.json) carry these extra fields
type HttpError = Error & { type?: string; status?: number; expose?: boolean };

const isHttpError = (err: unknown): err is HttpError => err instanceof Error;

// Runs only if no route matched the URL
export const notFound = (req: Request, res: Response, next: NextFunction): void => {
  next(new AppError(404, `Route ${req.method} ${req.originalUrl} not found`));
};

// Every error in the app ends up here (4 parameters = error handler).
// err is "unknown": anything can be thrown in JavaScript, so it's checked before use.
export const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction): void => {

  // Errors we threw on purpose
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.errors && { errors: err.errors })
    });
    return;
  }

  // Bad requests detected by express.json(), e.g. broken JSON or a body that's too big
  if (isHttpError(err) && err.type === "entity.parse.failed") {
    res.status(400).json({
      success: false,
      message: "Request body is not valid JSON"
    });
    return;
  }

  if (isHttpError(err) && err.expose && err.status !== undefined && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({
      success: false,
      message: err.message
    });
    return;
  }

  // Anything else is a bug or an outage: log the details, hide them from the client.
  // Handing the error to the request logger puts the full stack trace into this
  // request's single log line, next to its request id.
  res.err = err instanceof Error ? err : new Error(String(err));

  res.status(500).json({
    success: false,
    message: "Internal server error",
    // The client can quote this id, and we can find the exact log line
    requestId: req.id
  });
};
