import pino from "pino";
import { env } from "./env.ts";

// One logger for the whole server. Each entry is a JSON object, e.g.
// {"level":30,"time":1760500000000,"msg":"Server running","port":3000}
export const logger = pino({
  level: env.LOG_LEVEL,

  // Secrets must never end up in log files, wherever they appear in a logged object
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers[\"x-razorpay-signature\"]",
      "*.password",
      "*.currentPassword",
      "*.newPassword",
      "*.token",
      "*.razorpaySignature"
    ],
    censor: "[REDACTED]"
  },

  // While developing, print readable coloured lines instead of raw JSON.
  // (pino-pretty is a devDependency, so this must never run in production.)
  ...(env.NODE_ENV === "development" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname,res", singleLine: true }
    }
  })
});
