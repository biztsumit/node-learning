// Teaches TypeScript about what OUR middleware adds to Express's request object.
// A ".d.ts" file only describes types: it contains no code, and Node never loads it.
//
// "declare module" + "interface" = declaration merging: our fields are added to Express's own
// Request type, so every route handler knows that req.user exists (once logged in).
import "express-serve-static-core";

export type Role = "user" | "admin";

export type AuthUser = {
  id: string;
  role: Role;
};

declare module "express-serve-static-core" {
  interface Request {
    // Set by requireAuth. Optional: on public routes nobody is logged in.
    user?: AuthUser;
    // Set by the request logger (pino-http): this request's id, also sent in error responses
    id?: string | number | object;
  }
}
