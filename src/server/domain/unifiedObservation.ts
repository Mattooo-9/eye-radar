import type { Observation, SourceKind, TrackType } from "./types.js";

export type SourceFamily =
  | "adsb"
  | "radar"
  | "acoustic"
  | "optical"
  | "alert"
  | "weather"
  | "osint"
  | "manual"
  | "simulation";

export interface UnifiedObservation {
  source_id: string;
  source_family: SourceFamily;
  event_id: string;
  object_id?: string;
  observed_at: number;
  published_at: number;
  received_at: number;
  processed_at: number;
  lat: number;
  lon: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  vertical_rate?: number;
  object_type: TrackType | "unknown";
  measurement_accuracy: number; // in meters (1-sigma)
  source_quality: number;       // [0..1]
  confidence: number;           // [0..1]
  covariance?: [number, number, number, number]; // [varLat, covLatLon, covLonLat, varLon]
  evidence?: string[];
  provenance?: string;
  model?: string;
  callsign?: string;
}

/**
 * Normalizes any legacy or adapter observation into the Unified Observation Schema
 */
export function createUnifiedObservation(partial: Partial<UnifiedObservation> & {
  source_id: string;
  source_family: SourceFamily;
  lat: number;
  lon: number;
  object_type: TrackType | "unknown";
}): UnifiedObservation {
  const now = Date.now();
  const observedAt = partial.observed_at ?? now;
  const publishedAt = partial.published_at ?? observedAt;
  const receivedAt = partial.received_at ?? now;
  const processedAt = now;

  return {
    source_id: partial.source_id,
    source_family: partial.source_family,
    event_id: partial.event_id ?? `evt-${partial.source_family}-${now.toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
    object_id: partial.object_id,
    observed_at: observedAt,
    published_at: publishedAt,
    received_at: receivedAt,
    processed_at: processedAt,
    lat: Math.round(partial.lat * 1_000_000) / 1_000_000,
    lon: Math.round(partial.lon * 1_000_000) / 1_000_000,
    altitude: partial.altitude !== undefined ? Math.round(partial.altitude) : undefined,
    speed: partial.speed !== undefined ? Math.round(partial.speed * 10) / 10 : undefined,
    heading: partial.heading !== undefined ? Math.round(partial.heading * 10) / 10 : undefined,
    vertical_rate: partial.vertical_rate !== undefined ? Math.round(partial.vertical_rate * 10) / 10 : undefined,
    object_type: partial.object_type,
    measurement_accuracy: partial.measurement_accuracy ?? 500,
    source_quality: Math.min(1, Math.max(0, partial.source_quality ?? 0.8)),
    confidence: Math.min(1, Math.max(0, partial.confidence ?? 0.8)),
    covariance: partial.covariance,
    evidence: partial.evidence ?? [],
    provenance: partial.provenance,
    model: partial.model,
    callsign: partial.callsign
  };
}

/**
 * Convert UnifiedObservation to backward-compatible Observation
 */
export function toObservation(u: UnifiedObservation): Observation {
  const sourceKindMap: Record<SourceFamily, SourceKind> = {
    adsb: "sdr",
    radar: "sdr",
    acoustic: "osint",
    optical: "osint",
    alert: "alerts",
    weather: "weather",
    osint: "osint",
    manual: "manual",
    simulation: "simulation"
  };

  return {
    id: u.object_id ?? u.event_id,
    type: u.object_type === "unknown" ? "uav" : u.object_type,
    lat: u.lat,
    lon: u.lon,
    heading: u.heading,
    speed: u.speed,
    altitude: u.altitude,
    timestamp: u.observed_at,
    source: sourceKindMap[u.source_family] ?? "sdr",
    confidence: u.confidence,
    meta: {
      source_id: u.source_id,
      source_family: u.source_family,
      measurement_accuracy: u.measurement_accuracy,
      source_quality: u.source_quality,
      evidence: (u.evidence ?? []).join("; "),
      provenance: u.provenance ?? "",
      model: u.model ?? "",
      callsign: u.callsign ?? "",
      received_at: u.received_at,
      latency_ms: Math.max(0, u.received_at - u.observed_at)
    }
  };
}
