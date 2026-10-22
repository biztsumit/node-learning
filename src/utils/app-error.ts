// One problem with one input field, e.g. { field: "email", message: "email is required" }
export type FieldError = {
  field: string;
  message: string;
};

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
