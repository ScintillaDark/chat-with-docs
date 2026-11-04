import pino from "pino";

import { config } from "./config";

export const logger = pino({
  level: config.logLevel,
  base: {
    service: "chat-with-docs",
    environment: process.env.NODE_ENV ?? "development",
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.apiKey",
      "*.password",
      "*.prompt",
      "*.content",
    ],
    censor: "[REDACTED]",
  },
});
