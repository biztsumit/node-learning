// Cursor ("keyset") pagination: instead of "skip 40 rows" (OFFSET), say "continue after THIS row".
//
// A list is sorted by some columns that end with the id, e.g. (created_at DESC, id DESC), so every
// row has a unique position. The cursor is simply the last row's values for those columns.
// The next page is: rows that come after it in the sort order.
//
//   WHERE (p.created_at, p.id) < ('2026-10-21 15:21:02.123456+05:30', '01a1...')
//
// That's a "row comparison": compare created_at first, and only if equal, compare id.
// With an index on the same columns, PostgreSQL jumps straight to that spot: page 5,000 is
// as fast as page 1. And rows added or removed meanwhile can't shift what comes next.
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { AppError } from "./app-error.ts";

// The PostgreSQL types a sort column can have (each has a check below)
export type KeyType = "uuid" | "integer" | "numeric" | "real" | "varchar" | "timestamptz";

// A value a cursor can carry: what JSON gives back for our column types
type CursorValue = string | number;

export type SortKey = {
  column: string;                                   // SQL, e.g. "p.created_at"
  type: KeyType;
  value: (row: QueryResultRow) => CursorValue;      // where the page's last row keeps it
};

export type Sort = {
  name: string;
  direction: "asc" | "desc";
  keys: SortKey[];
};

// Page numbers: page, total, totalPages. Cursor: only limit and nextCursor.
export type Pagination = {
  page?: number;
  limit: number;
  total?: number;
  totalPages?: number;
  nextCursor: string | null;
};

const invalidCursor = () =>
  new AppError(400, "Validation failed", [
    { field: "cursor", message: "cursor is invalid, or belongs to a different sort order. Start again without it" }
  ]);

// The cursor is opaque to clients: base64url of ["sort name", ...values].
// It's not secret (anyone can decode it); it just shouldn't be built or edited by hand.
const encode = (sortName: string, values: CursorValue[]): string =>
  Buffer.from(JSON.stringify([sortName, ...values])).toString("base64url");

// What each column type's cursor value must look like. Values are always sent as $1
// parameters (never pasted into the SQL), so a forged cursor can't inject anything; this check
// makes it a clear 400 instead of PostgreSQL failing to convert it (a 500).
//
// "(v: unknown) => v is CursorValue" is a TYPE GUARD: when it returns true, TypeScript knows
// v is a string or number from then on. Record<KeyType, ...> makes sure every type has a check.
const VALID_VALUE: Record<KeyType, (v: unknown) => v is CursorValue> = {
  uuid: (v): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v),
  integer: (v): v is number => typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= 2147483647,
  numeric: (v): v is string => typeof v === "string" && /^-?\d{1,12}(\.\d{1,6})?$/.test(v),
  real: (v): v is string => typeof v === "string" && v.length <= 30 && Number.isFinite(Number(v)),
  varchar: (v): v is string => typeof v === "string" && v.length <= 255,
  timestamptz: (v): v is string =>
    typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")))
};

const decode = (cursor: string, sortName: string, keys: SortKey[]): CursorValue[] => {
  // JSON.parse can return anything: "unknown" makes us check before using it
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (!Array.isArray(parsed) || parsed.length !== keys.length + 1 || parsed[0] !== sortName) {
    throw invalidCursor();
  }
  const values: unknown[] = parsed.slice(1);
  const checked: CursorValue[] = [];
  keys.forEach((key, i) => {
    const value = values[i];
    if (!VALID_VALUE[key.type](value)) {
      throw invalidCursor();
    }
    checked.push(value);
  });
  return checked;
};

// Returns the WHERE condition for "after this cursor" (values added with addValue, cast to
// their type, so a cursor can only ever be data, never SQL).
// All of a sort's keys go the same direction, and the last one is unique (the id).
export const afterCursor = (sort: Sort, cursor: string, addValue: (value: unknown) => string): string => {
  const values = decode(cursor, sort.name, sort.keys);
  const columns = sort.keys.map((key) => key.column).join(", ");
  const placeholders = sort.keys.map((key, i) => `${addValue(values[i])}::${key.type}`).join(", ");
  return `(${columns}) ${sort.direction === "desc" ? "<" : ">"} (${placeholders})`;
};

// We ask the database for limit + 1 rows: if the extra one exists, there IS a next page
// (without having to count everything). Returns the page and the cursor for the next one.
// <Row>: the rows come back with the same type they went in with.
export const cursorPage = <Row extends QueryResultRow>(
  rows: Row[],
  limit: number,
  sort: Sort | null
): { rows: Row[]; nextCursor: string | null } => {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor: hasMore && sort && last ? encode(sort.name, sort.keys.map((key) => key.value(last))) : null
  };
};

// Timestamps are compared using the text PostgreSQL sends (to the microsecond).
// A JavaScript Date only keeps milliseconds: "15:21:02.123456" would become ".123",
// and the row at .123456 would be skipped or repeated.
export const timestampKey = (column: string): string => `${column}::text`;

type PagedQueryOptions = {
  select: string;            // "SELECT ..." (include the columns the sort's value(row) functions read)
  from: string;              // "FROM ... JOIN ..." (also used for the total count)
  conditions: string[];      // the filters, using values/addValue
  values: unknown[];
  addValue: (value: unknown) => string;
  sort: Sort;
  page?: number;
  cursor?: string;
  limit: number;
};

// A whole list query with either kind of paging, for the simpler lists (orders, stock ledger).
// With page numbers: {page, limit, total, totalPages, nextCursor}; with a cursor: {limit,
// nextCursor} (no total: counting a huge list is the slow part).
export const pagedQuery = async (
  db: Pool | PoolClient,
  { select, from, conditions, values, addValue, sort, page, cursor, limit }: PagedQueryOptions
): Promise<{ rows: QueryResultRow[]; pagination: Pagination }> => {
  const filterWhere = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const filterValues = [...values];

  const all = cursor === undefined ? conditions : [...conditions, afterCursor(sort, cursor, addValue)];
  const where = all.length > 0 ? `WHERE ${all.join(" AND ")}` : "";
  const orderBy = sort.keys.map((key) => `${key.column} ${sort.direction.toUpperCase()}`).join(", ");
  const offset = cursor === undefined ? ((page ?? 1) - 1) * limit : 0;

  const rowsQuery = db.query(
    `${select} ${from} ${where}
     ORDER BY ${orderBy}
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit + 1, offset]
  );

  if (cursor !== undefined) {
    const { rows, nextCursor } = cursorPage((await rowsQuery).rows, limit, sort);
    return { rows, pagination: { limit, nextCursor } };
  }

  const [rowsResult, countResult] = await Promise.all([
    rowsQuery,
    db.query<{ total: number }>(`SELECT COUNT(*)::int AS total ${from} ${filterWhere}`, filterValues)
  ]);
  const total = countResult.rows[0]?.total ?? 0;
  const { rows, nextCursor } = cursorPage(rowsResult.rows, limit, sort);
  return { rows, pagination: { page: page ?? 1, limit, total, totalPages: Math.ceil(total / limit), nextCursor } };
};
