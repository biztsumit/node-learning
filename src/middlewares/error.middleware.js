import { AppError } from "../utils/app-error.js";

// Runs only if no route matched the URL
export const notFound = (req, res, next) => {
  next(new AppError(404, `Route ${req.method} ${req.originalUrl} not found`));
};

// Every error in the app ends up here (4 parameters = error handler)
export const errorHandler = (err, req, res, next) => {

  // Errors we threw on purpose
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.errors && { errors: err.errors })
    });
  }

  // Bad requests detected by express.json(), e.g. broken JSON or a body that's too big
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Request body is not valid JSON"
    });
  }

  if (err.expose && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({
      success: false,
      message: err.message
    });
  }

  // Anything else is a bug or an outage: log the details, hide them from the client
  console.error(err);

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
};
