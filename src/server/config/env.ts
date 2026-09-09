import { config } from "dotenv";

config();

const required = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env variable: ${name}`);
  }

  return value;
};

const numberValue = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  host: process.env.HOST ?? "0.0.0.0",
  port: numberValue("PORT", 3000),
  clientPort: numberValue("CLIENT_PORT", 5173),
  botToken: required("BOT_TOKEN"),
  adminId: required("ADMIN_ID"),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
  webAppPath: process.env.WEB_APP_PATH ?? "/app",
  wsPath: process.env.WS_PATH ?? "/ws",
  mapStyleUrl:
    process.env.MAP_STYLE_URL ?? "https://demotiles.maplibre.org/style.json",
  jitterRadiusKm: numberValue("JITTER_RADIUS_KM", 15),
  trustMinScore: numberValue("TRUST_MIN_SCORE", 55),
  upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL,
  upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY
};

export const isProduction = env.nodeEnv === "production";
