// "Who is doing this?", available anywhere during a request (or a background job),
// without passing it through every function.
//
// AsyncLocalStorage keeps a value attached to one chain of async work: everything that runs
// because of THIS request (awaits, callbacks, database calls) sees this request's store,
// even while hundreds of other requests are being handled at the same time.
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

export type RequestContext = {
  // "api", "job:maintenance", "script:make-admin"...
  source: string;
  requestId: string | null;
  // The logged-in user, once requireAuth knows who it is
  userId: string | null;
};

const storage = new AsyncLocalStorage<RequestContext>();

// The current store, or undefined outside any request/job
export const getContext = (): RequestContext | undefined => storage.getStore();

// Runs fn with a fresh context. <T>: returns whatever fn returns, with its type.
export const runWithContext = <T>(context: Pick<RequestContext, "source"> & Partial<RequestContext>, fn: () => T): T =>
  storage.run({ userId: null, requestId: null, ...context }, fn);

// Middleware: every request starts its own context (after the request logger gave it an id)
export const requestContext = (req: Request, res: Response, next: NextFunction): void => {
  runWithContext({ source: "api", requestId: req.id ? String(req.id) : null }, next);
};

// Called by requireAuth once it knows who's logged in
export const setActor = (userId: string): void => {
  const store = storage.getStore();
  if (store) {
    store.userId = userId;
  }
};
