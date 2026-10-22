// Reading the audit log (it's written by database triggers, see migration 026)
import pool from "../config/db.ts";
import { pagedQuery, timestampKey, type Pagination, type Sort } from "../utils/cursor.ts";
import type { AuditLogQuery } from "../validators/audit.validators.ts";

// ": Sort" checks it: direction must be "asc" or "desc", and each key's type one we can validate
const AUDIT_SORT: Sort = {
  name: "audit",
  direction: "desc",
  keys: [
    { column: "a.created_at", type: "timestamptz", value: (row) => row.created_key },
    { column: "a.id", type: "uuid", value: (row) => row.id }
  ]
};

type AuditRow = {
  id: string;
  table_name: string;
  record_id: string;
  action: "insert" | "update" | "delete";
  changes: Record<string, unknown>;   // JSONB arrives already parsed
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  source: string;
  request_id: string | null;
  created_at: Date;
};

export type AuditEntry = {
  id: string;
  table: string;
  recordId: string;
  action: AuditRow["action"];
  changes: Record<string, unknown>;
  actor: { id: string; name: string | null; email: string | null } | null;
  source: string;
  requestId: string | null;
  createdAt: Date;
};

const toEntry = (row: AuditRow): AuditEntry => ({
  id: row.id,
  table: row.table_name,
  recordId: row.record_id,
  action: row.action,
  // update: { "price": [old, new] }; insert/delete: the whole row
  changes: row.changes,
  // null = not a logged-in person: a background job, a webhook, or SQL run by hand (see source)
  actor: row.actor_id ? { id: row.actor_id, name: row.actor_name, email: row.actor_email } : null,
  source: row.source,
  requestId: row.request_id,
  createdAt: row.created_at
});

// GET /admin/audit-log, newest first
export const listAuditLog = async (
  { table, recordId, actorId, action, page, cursor, limit }: AuditLogQuery
): Promise<{ entries: AuditEntry[]; pagination: Pagination }> => {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const addValue = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (table !== undefined) {
    conditions.push(`a.table_name = ${addValue(table)}`);
  }
  if (recordId !== undefined) {
    conditions.push(`a.record_id = ${addValue(recordId)}`);
  }
  if (actorId !== undefined) {
    conditions.push(`a.actor_id = ${addValue(actorId)}`);
  }
  if (action !== undefined) {
    conditions.push(`a.action = ${addValue(action)}`);
  }

  const { rows, pagination } = await pagedQuery(pool, {
    select: `SELECT a.*, ${timestampKey("a.created_at")} AS created_key, u.name AS actor_name, u.email AS actor_email`,
    // LEFT JOIN: the entry stays even if that user has since been deleted
    from: "FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id",
    conditions, values, addValue, sort: AUDIT_SORT, page, cursor, limit
  });

  // pagedQuery can't know the columns of every query it runs, so we say what these rows are
  return { entries: (rows as AuditRow[]).map(toEntry), pagination };
};
