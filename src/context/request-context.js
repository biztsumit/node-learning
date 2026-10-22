// "Who is doing this?", available anywhere during a request (or a background job),
// without passing it through every function.
//
// AsyncLocalStorage keeps a value attached to one chain of async work: everything that runs
// because of THIS request (awaits, callbacks, database calls) sees this request's store,
// even while hundreds of other requests are being handled at the same time.
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

// The current store: { source, requestId, userId }, or undefined outside any request/job
export const getContext = () => storage.getStore();

// Runs fn with a fresh context
export const runWithContext = (context, fn) => storage.run({ userId: null, requestId: null, ...context }, fn);

// Middleware: every request starts its own context (after the request logger gave it an id)
export const requestContext = (req, res, next) => {
  runWithContext({ source: "api", requestId: String(req.id ?? "") || null }, next);
};

// Called by requireAuth once it knows who's logged in
export const setActor = (userId) => {
  const store = storage.getStore();
  if (store) {
    store.userId = userId;
  }
};
