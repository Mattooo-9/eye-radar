import pino from "pino";

const isTest = process.env.NODE_ENV === "test";
const level = process.env.LOG_LEVEL || (isTest ? "silent" : "info");
const releaseSha = (
  process.env.RENDER_GIT_COMMIT ||
  process.env.GITHUB_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  "dev"
).slice(0, 12);

/**
 * Canonical structured JSON logger (Pino).
 * Zero worker transports -> minimal memory footprint and clean ESM bundling on Render.
 * Automatically redacts sensitive credentials and headers.
 */
export const logger = pino({
  level,
  base: {
    service: "eye-radar",
    releaseSha,
    env: process.env.NODE_ENV || "development"
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers['x-api-key']",
      "headers.authorization",
      "token",
      "botToken",
      "apiKey",
      "databaseUrl",
      "password"
    ],
    censor: "[REDACTED]"
  }
});

export const createLogger = (moduleName: string) => logger.child({ module: moduleName });
