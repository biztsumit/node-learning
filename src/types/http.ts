import type { Request } from "express";

// A request whose parts were already checked by validate() in the route, so params, body and
// query have the types of the zod schemas used there. Express's own generics:
// Request<Params, ResponseBody, RequestBody, Query>.
//
//   router.post("/", validate({ body: createAddressSchema }), addAddress);
//   export const addAddress = async (req: Checked<{}, CreateAddress>, res: Response) => { ... }
//
// This is a PROMISE the route keeps: TypeScript can't see that the route really ran
// validate() with that schema. So route and controller must agree (and the tests check it).
export type Checked<Params = Record<string, never>, Body = unknown, Query = Record<string, never>> =
  Request<Params, unknown, Body, Query>;

// For middleware that works with ANY request (validate, requireAuth...): it doesn't care what
// the params, body or query look like. With Express's default type instead, it would clash
// with a controller in the same route that declares its checked query (e.g. page: number).
export type AnyRequest = Request<unknown, unknown, unknown, unknown>;
