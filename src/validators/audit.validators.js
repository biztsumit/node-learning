import { z } from "zod";
import { idSchema, cursorPaginationFields, pageOrCursor } from "./common.validators.js";

// PATCH /users/:id/role
export const roleSchema = z.object({
  role: z.enum(["user", "admin"], { error: "role must be user or admin" })
});

export const AUDITED_TABLES = ["products", "product_variants", "categories", "coupons", "orders", "users"];

// GET /admin/audit-log?table=orders&recordId=<uuid>&actorId=<uuid>&action=update
export const auditLogQuerySchema = z
  .object({
    table: z.enum(AUDITED_TABLES, { error: `table must be one of: ${AUDITED_TABLES.join(", ")}` }).optional(),
    recordId: idSchema("recordId").optional(),
    actorId: idSchema("actorId").optional(),
    action: z.enum(["insert", "update", "delete"], { error: "action must be insert, update or delete" }).optional(),
    ...cursorPaginationFields
  })
  .refine(...pageOrCursor);
