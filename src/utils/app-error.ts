// One problem with one input field, e.g. { field: "email", message: "email is required" }
export type FieldError = {
  field: string;
  message: string;
};

// The message of anything that was thrown. In "catch (err)", err is unknown: JavaScript can
// throw any value, not only Error objects.
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// An error we throw on purpose, carrying the HTTP status to send back.
// Example: throw new AppError(404, "Product not found");
export class AppError extends Error {
  statusCode: number;
  errors: FieldError[] | undefined;

  constructor(statusCode: number, message: string, errors?: FieldError[]) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
