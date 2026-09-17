// src/server/domain/uncertaintyEvent.ts

export type UncertaintySourceFamily = "acoustic" | "optical" | "thermal" | "osint" | "radar" | "satellite";

export interface UncertaintyEvent {
  id: string;
  lat: number;
  lon: number;
  uncertaintyRadius: number; // radius in meters, e.g. 12000 for acoustic array, 2500 for FIRMS hotspot
  confidence: number; // 0.0 to 1.0
  source: string;
  sourceFamily: UncertaintySourceFamily;
  label: string;
  timestamp: number;
  details?: string;
  ttlMs?: number;
}

export function validateUncertaintyEvent(event: unknown): event is UncertaintyEvent {
  if (!event || typeof event !== "object") return false;
  const e = event as UncertaintyEvent;
  if (typeof e.id !== "string" || e.id.length === 0) return false;
  if (typeof e.lat !== "number" || isNaN(e.lat) || e.lat < -90 || e.lat > 90) return false;
  if (typeof e.lon !== "number" || isNaN(e.lon) || e.lon < -180 || e.lon > 180) return false;
  if (typeof e.uncertaintyRadius !== "number" || isNaN(e.uncertaintyRadius) || e.uncertaintyRadius <= 0) return false;
  if (typeof e.confidence !== "number" || isNaN(e.confidence)) return false;
  if (typeof e.timestamp !== "number" || isNaN(e.timestamp)) return false;
  if (typeof e.source !== "string" || typeof e.sourceFamily !== "string") return false;
  return true;
}
