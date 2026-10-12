// An error we throw on purpose, carrying the HTTP status to send back.
// Example: throw new AppError(404, "Product not found");
export class AppError extends Error {
  constructor(statusCode, message, errors) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
