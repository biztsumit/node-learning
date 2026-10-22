import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { pinoHttp } from "pino-http";
import { logger } from "../config/logger.js";

// A client (or a proxy) may send its own request id; accept it only if it looks safe
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,100}$/;

const summary = (req: Request, res: Response): string => `${req.method} ${req.originalUrl} ${res.statusCode}`;

// Writes ONE log line per request when its response is finished, e.g.
// INFO: GET /products?limit=2 200 12ms  {req: {id: "6f1c…", ip: "203.0.113.10"}, userId: 7}
// <Request, Response>: pino-http works with plain Node requests; telling it these are Express's
// lets the callbacks below use req.originalUrl and req.user with their real types
export const requestLogger = pinoHttp<Request, Response>({
  logger,

  // Every request gets an id. It's sent back in the X-Request-Id header (and in 500 errors),
  // so "my order failed" can be matched to the exact log line.
  genReqId: (req, res) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },

  // 5xx = our bug (error), 4xx = the client's mistake (warn), the rest = info
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },

  // e.g. "GET /products 200 12ms". (The time is also in the line's "responseTime" field.)
  customSuccessMessage: (req, res, responseTime) => `${summary(req, res)} ${Math.round(responseTime)}ms`,
  // e.g. "GET /categories 500 failed: relation ... does not exist" (full stack in the "err" field)
  customErrorMessage: (req, res, err) => `${summary(req, res)} failed: ${err.message}`,

  // Added when the response finishes, so requireAuth has already set req.user
  customProps: (req) => ({ userId: req.user?.id }),

  // Keep log lines short: only what's useful, never headers or bodies
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url, ip: req.raw.ip }),
    res: (res) => ({ statusCode: res.statusCode })
  }
});
