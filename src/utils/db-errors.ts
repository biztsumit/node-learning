// PostgreSQL error codes we handle on purpose.
// Full list: https://www.postgresql.org/docs/current/errcodes-appendix.html
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503"; // pointing at a row that doesn't exist
export const PG_RESTRICT_VIOLATION = "23001";    // deleting a row that ON DELETE RESTRICT protects

// What a database error from pg looks like (the parts we read).
// A caught error has the type "unknown" (anything can be thrown in JavaScript), so code
// checks it with isDatabaseError(err) before reading err.code or err.constraint.
export type DatabaseError = Error & {
  code: string;
  constraint?: string;
};

export const isDatabaseError = (err: unknown): err is DatabaseError =>
  err instanceof Error && typeof (err as { code?: unknown }).code === "string";
