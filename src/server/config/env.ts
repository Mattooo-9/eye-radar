import { config } from "dotenv";
import { ServerEnvSchema } from "../validation/schemas.js";
import { createLogger } from "../observability/logger.js";

config();

const log = createLogger("env");

const required = (name: string, fallback = ""): string => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    if (process.env.NODE_ENV === "test" || process.env.VERCEL) {
      return fallback;
    }
    throw new Error(`Missing required env variable: ${name}`);
  }
  return value;
};

const rawParsed = ServerEnvSchema.safeParse({
  nodeEnv: process.env.NODE_ENV ?? "development",
  host: process.env.HOST ?? "0.0.0.0",
  port: process.env.PORT ?? 3000,
  clientPort: process.env.CLIENT_PORT ?? 5173,
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
  webAppPath: process.env.WEB_APP_PATH ?? "/app",
  wsPath: process.env.WS_PATH ?? "/ws",
  mapStyleUrl:
    process.env.MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/dark",
  pmtilesUrl: process.env.PMTILES_URL ?? "",
  jitterRadiusKm: process.env.JITTER_RADIUS_KM ?? 15,
  trustMinScore: process.env.TRUST_MIN_SCORE ?? 55
});

if (!rawParsed.success) {
  log.warn({ issues: rawParsed.error.issues }, "Environment variable validation fell back to defaults");
}

const validated = rawParsed.success ? rawParsed.data : ServerEnvSchema.parse({});

export const env = {
  ...validated,
  botToken: required("BOT_TOKEN"),
  adminId: required("ADMIN_ID"),
  upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL,
  upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY
};

export const isProduction = env.nodeEnv === "production";
