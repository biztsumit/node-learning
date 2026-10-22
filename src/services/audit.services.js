// Reading the audit log (it's written by database triggers, see migration 026)
import pool from "../config/db.js";
import { pagedQuery, timestampKey } from "../utils/cursor.ts";

const AUDIT_SORT = {
  name: "audit",
  direction: "desc",
  keys: [
    { column: "a.created_at", type: "timestamptz", value: (row) => row.created_key },
    { column: "a.id", type: "uuid", value: (row) => row.id }
  ]
};

const toEntry = (row) => ({
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
export const listAuditLog = async ({ table, recordId, actorId, action, page, cursor, limit }) => {
  const conditions = [];
  const values = [];
  const addValue = (value) => {
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

  return { entries: rows.map(toEntry), pagination };
};
