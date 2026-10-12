// PostgreSQL error codes we handle on purpose.
// Full list: https://www.postgresql.org/docs/current/errcodes-appendix.html
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503"; // pointing at a row that doesn't exist
export const PG_RESTRICT_VIOLATION = "23001";    // deleting a row that ON DELETE RESTRICT protects
