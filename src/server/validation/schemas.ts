import { z } from "zod";

export const UkraineLatSchema = z.number().finite().min(44.0).max(52.6);
export const UkraineLonSchema = z.number().finite().min(22.0).max(40.5);

export const CompassDirectionSchema = z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);

const sanitizeText = (maxLen: number) =>
  z
    .string()
    .transform((s) => s.replace(/[<>\r\n]+/g, " ").trim().slice(0, maxLen));

const PositiveChatIdSchema = z
  .union([z.number(), z.string()])
  .transform((val) => (typeof val === "number" ? Math.trunc(val) : Number.parseInt(val.trim(), 10)))
  .refine((n) => Number.isFinite(n) && n > 0, { message: "Valid positive Telegram user/chat ID required" });

/** POST /api/report — citizen eyewitness report */
export const CitizenReportSchema = z.object({
  type: z.string().trim().min(1).max(40).default("uav_sound"),
  lat: UkraineLatSchema,
  lon: UkraineLonSchema,
  direction: CompassDirectionSchema.optional(),
  comment: sanitizeText(240).optional().default("")
});

export type CitizenReportInput = z.infer<typeof CitizenReportSchema>;

/** POST /api/location — persist user location in Neon Postgres */
export const LocationSaveSchema = z.object({
  userId: PositiveChatIdSchema,
  lat: UkraineLatSchema,
  lon: UkraineLonSchema,
  name: sanitizeText(120).optional(),
  cityName: sanitizeText(120).optional(),
  accuracy: z.number().finite().min(1).max(100_000).optional(),
  source: z.string().trim().max(40).optional(),
  trusted: z.boolean().optional(),
  radiusKm: z.number().finite().min(5).max(150).optional()
});

/** POST /api/alerts/subscribe — Telegram bot proximity alerts subscription */
export const AlertSubscribeSchema = z.object({
  userId: PositiveChatIdSchema,
  lat: UkraineLatSchema.optional().default(50.45),
  lon: UkraineLonSchema.optional().default(30.52),
  cityName: sanitizeText(120).optional(),
  radiusKm: z.number().finite().min(5).max(150).optional().default(30)
});

/** POST /api/ingest/osint — authenticated OSINT text or batch observation ingest */
const RawObservationSchema = z.object({
  id: z.string().trim().min(1).max(120),
  type: z.enum(["uav", "munition", "aircraft", "helicopter", "bomb", "fpv", "thermal", "unknown"]),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  heading: z.number().finite().min(0).max(360).optional(),
  speed: z.number().finite().min(0).max(3500).optional(),
  altitude: z.number().finite().min(0).max(100_000).optional(),
  timestamp: z.number().finite().positive(),
  source: z.enum(["osint", "sdr", "manual", "adsb", "adsb.lol", "airplanes.live", "opensky", "firms", "simulation"]),
  confidence: z.number().finite().min(0).max(1),
  uncertaintyRadius: z.number().finite().min(1).max(500_000).optional(),
  isSynthetic: z.boolean().optional(),
  meta: z.record(z.string(), z.unknown()).optional()
});

export const OsintIngestSchema = z
  .object({
    text: z.string().trim().min(1).max(4000).optional(),
    observations: z.array(RawObservationSchema).max(100).optional()
  })
  .refine((v) => Boolean(v.text) || (Array.isArray(v.observations) && v.observations.length > 0), {
    message: "Either text or non-empty observations array is required"
  });

/** POST /api/ingest/sdr — authenticated SDR telemetry ingest */
export const SdrPayloadItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  heading: z.number().finite().min(0).max(360).optional(),
  speed: z.number().finite().min(0).max(3500).optional(),
  altitude: z.number().finite().min(0).max(100_000).optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
  timestamp: z.number().finite().positive().optional(),
  type: z.enum(["uav", "munition", "aircraft", "helicopter", "bomb", "fpv", "thermal", "unknown"]).optional(),
  meta: z.record(z.string(), z.unknown()).optional()
});

export const SdrIngestSchema = z.object({
  observations: z.array(SdrPayloadItemSchema).min(1).max(200)
});

/** POST /api/diagnostics/client — bounded client telemetry */
export const ClientDiagnosticsSchema = z
  .object({
    fps: z.number().finite().min(0).max(240).optional(),
    frameTimeMs: z.number().finite().min(0).max(10_000).optional(),
    tracksRendered: z.number().int().min(0).max(50_000).optional(),
    tracksDecoded: z.number().int().min(0).max(1_000_000).optional(),
    wsLatencyMs: z.number().finite().min(0).max(60_000).optional(),
    tier: z.enum(["LOW", "NORMAL", "HIGH"]).optional()
  })
  .passthrough();

/** Query parameter schemas */
export const ReplayQuerySchema = z.object({
  offsetSec: z.coerce.number().finite().min(0).max(7200).default(0)
});

export const OsintFeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(25)
});

/** Startup environment schema */
export const ServerEnvSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  host: z.string().min(1).default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  clientPort: z.coerce.number().int().min(1).max(65535).default(5173),
  publicBaseUrl: z.string().url().default("http://localhost:3000"),
  webAppPath: z.string().startsWith("/").default("/app"),
  wsPath: z.string().startsWith("/").default("/ws"),
  mapStyleUrl: z.string().url().default("https://tiles.openfreemap.org/styles/dark"),
  pmtilesUrl: z.string().optional().default(""),
  jitterRadiusKm: z.coerce.number().finite().min(0).max(100).default(15),
  trustMinScore: z.coerce.number().finite().min(0).max(100).default(55)
});

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues: ValidationIssue[] };

export function parseWithSchema<T>(input: unknown, schema: z.ZodType<T>): ParseResult<T> {
  const res = schema.safeParse(input);
  if (res.success) {
    return { ok: true, data: res.data };
  }
  const issues: ValidationIssue[] = res.error.issues.map((iss) => ({
    path: iss.path.join(".") || "body",
    message: iss.message
  }));
  return {
    ok: false,
    error: issues.map((i) => `${i.path}: ${i.message}`).join("; "),
    issues
  };
}

export function parseJsonWithSchema<T>(raw: string, schema: z.ZodType<T>): ParseResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: "Invalid JSON payload",
      issues: [{ path: "body", message: "Malformed JSON" }]
    };
  }
  return parseWithSchema(parsed, schema);
}
