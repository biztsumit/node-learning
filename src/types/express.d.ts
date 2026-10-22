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
  // This login passed two-factor (see requireAdmin and REQUIRE_ADMIN_2FA)
  mfa: boolean;
};

declare module "express-serve-static-core" {
  interface Request {
    // Set by requireAuth. Optional: on public routes nobody is logged in.
    user?: AuthUser;
    // (req.id, the request's id, is declared by pino-http itself. Declaring it again here, with
    // a different type, quietly made Express's Request incompatible with Node's request type.)
  }
}
