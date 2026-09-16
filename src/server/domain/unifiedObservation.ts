import { createHash } from "node:crypto";
import type { Observation, SourceKind, TrackType } from "./types.js";

export type SourceFamily =
  | "adsb"
  | "radar"
  | "acoustic"
  | "optical"
  | "satellite"
  | "alert"
  | "weather"
  | "osint"
  | "manual"
  | "simulation";

export interface ProvenanceRecord {
  source: string;
  sourceFamily: SourceFamily;
  observedAt: number;
  receivedAt: number;
  processedAt: number;
  latencyMs: number;
  confidence: number;
  evidence: string[];
  provenanceStr?: string;
  isSynthetic?: boolean;
}

/**
 * Strict Unified Observation Contract v2
 * Standardized across all positional, contextual, radar, acoustic, optical, and satellite feeds.
 */
export interface UnifiedObservation {
  schemaVersion: number;        // Current: 2
  sourceId: string;             // Unique source identifier (e.g. "airplanes.live", "sdr.receiver")
  sensorType: string;           // Sensor modality (e.g. "adsb_transponder", "ground_radar", "acoustic_array", "satellite_sar")
  sourceFamily: SourceFamily;
  eventId: string;
  objectId?: string;
  observedAt: number;           // Corrected sensor timestamp (ms epoch)
  receivedAt: number;           // Server arrival timestamp (ms epoch)
  ageMs: number;                // Elapsed age at processing time
  latency: number;              // One-way or transit latency in ms
  clockOffset: number;          // Estimated sensor-to-server clock offset (ms)
  jitter: number;               // Measured arrival jitter (ms)
  uncertaintyRadius: number;    // 1-sigma spatial uncertainty in meters
  resolution?: number;          // Spatial or radar resolution (meters per sample/pixel)
  positionConfidence: number;   // [0..1] confidence in physical location and kinematics
  classConfidence: number;      // [0..1] confidence in classified target type/model
  provenance: string;           // Provenance lineage chain
  rawEvidenceHash: string;      // Deterministic SHA-256 hash of raw input packet

  // Kinematic & physical parameters
  lat: number;
  lon: number;
  altitude?: number;
  speed?: number;               // m/s
  heading?: number;             // degrees (0..359.9)
  verticalRate?: number;        // m/s
  objectType: TrackType | "unknown";
  model?: string;
  callsign?: string;
  evidence?: string[];
  threatEvidence?: string[];
  isSynthetic?: boolean;

  // EW / Spoofing / Jamming Resiliency Flags
  isDegraded?: boolean;
  ewFlags?: string[];

  // Backward compatibility alias properties for legacy consumers
  id?: string;
  source_id?: string;
  source_family?: SourceFamily;
  event_id?: string;
  object_id?: string;
  object_type?: TrackType | "unknown";
  vertical_rate?: number;
  observed_at?: number;
  published_at?: number;
  received_at?: number;
  processed_at?: number;
  measurement_accuracy?: number;
  source_quality?: number;
  confidence?: number;
  covariance?: [number, number, number, number];
}

/**
 * Computes deterministic SHA-256 evidence hash from raw sensor payload
 */
export function computeRawEvidenceHash(payload: unknown): string {
  try {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    return createHash("sha256").update(raw || "").digest("hex").slice(0, 16);
  } catch {
    return "0000000000000000";
  }
}

/**
 * Creates and normalizes a UnifiedObservation following the v2 contract
 */
export function createUnifiedObservation(partial: Partial<UnifiedObservation> & {
  source_id?: string;
  sourceId?: string;
  source_family?: SourceFamily;
  sourceFamily?: SourceFamily;
  sensorType?: string;
  lat: number;
  lon: number;
  object_type?: TrackType | "unknown";
  objectType?: TrackType | "unknown";
  rawPayload?: unknown;
}): UnifiedObservation {
  const now = Date.now();
  const sourceId = partial.sourceId ?? partial.source_id ?? "unknown.source";
  const sourceFamily = partial.sourceFamily ?? partial.source_family ?? "adsb";
  const observedAt = partial.observedAt ?? partial.observed_at ?? now;
  const receivedAt = partial.receivedAt ?? partial.received_at ?? now;
  const ageMs = partial.ageMs ?? Math.max(0, now - observedAt);
  const latency = partial.latency ?? Math.max(0, receivedAt - observedAt);
  const clockOffset = partial.clockOffset ?? 0;
  const jitter = partial.jitter ?? 0;
  const uncertaintyRadius = partial.uncertaintyRadius ?? partial.measurement_accuracy ?? 350;
  const objectType = partial.objectType ?? partial.object_type ?? "unknown";
  const posConf = partial.positionConfidence ?? partial.confidence ?? 0.85;
  const classConf = partial.classConfidence ?? 0.40;

  const eventId = partial.eventId ?? partial.event_id ??
    `evt-${sourceFamily}-${now.toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const objectId = partial.objectId ?? partial.object_id ?? partial.id;
  const sensorType = partial.sensorType ?? `${sourceFamily}_sensor`;

  const rawHash = partial.rawEvidenceHash ??
    (partial.rawPayload ? computeRawEvidenceHash(partial.rawPayload) : computeRawEvidenceHash({ sourceId, observedAt, lat: partial.lat, lon: partial.lon }));

  const obs: UnifiedObservation = {
    schemaVersion: 2,
    sourceId,
    sensorType,
    sourceFamily,
    eventId,
    objectId,
    observedAt,
    receivedAt,
    ageMs,
    latency,
    clockOffset,
    jitter,
    uncertaintyRadius,
    resolution: partial.resolution,
    positionConfidence: Math.min(1, Math.max(0, posConf)),
    classConfidence: Math.min(1, Math.max(0, classConf)),
    provenance: partial.provenance ?? `${sourceId} [${sensorType}] -> observed:${observedAt}`,
    rawEvidenceHash: rawHash,

    lat: Math.round(partial.lat * 1_000_000) / 1_000_000,
    lon: Math.round(partial.lon * 1_000_000) / 1_000_000,
    altitude: partial.altitude !== undefined ? Math.round(partial.altitude) : undefined,
    speed: partial.speed !== undefined ? Math.round(partial.speed * 10) / 10 : undefined,
    heading: partial.heading !== undefined ? Math.round(partial.heading * 10) / 10 : undefined,
    verticalRate: partial.verticalRate ?? partial.vertical_rate,
    objectType,
    model: partial.model,
    callsign: partial.callsign,
    evidence: partial.evidence ?? [],
    threatEvidence: partial.threatEvidence ?? [],
    isSynthetic: partial.isSynthetic ?? (sourceFamily === "simulation"),
    isDegraded: partial.isDegraded ?? false,
    ewFlags: partial.ewFlags ?? [],

    // Legacy backward-compatibility mirrors
    source_id: sourceId,
    source_family: sourceFamily,
    event_id: eventId,
    object_id: objectId,
    observed_at: observedAt,
    published_at: partial.published_at ?? observedAt,
    received_at: receivedAt,
    processed_at: now,
    measurement_accuracy: uncertaintyRadius,
    source_quality: partial.source_quality ?? posConf,
    confidence: posConf,
    covariance: partial.covariance
  };

  return obs;
}

/**
 * Evaluates freshness, applies confidence decay for aged observations, and checks TTL exclusion
 */
export function evaluateObservationFreshness(
  u: UnifiedObservation,
  now = Date.now(),
  maxTtlMs = 60_000
): { valid: boolean; ageMs: number; positionConfidence: number; classConfidence: number; isStale: boolean } {
  const ageMs = Math.max(0, now - u.observedAt);
  if (ageMs > maxTtlMs) {
    return {
      valid: false,
      ageMs,
      positionConfidence: 0,
      classConfidence: 0,
      isStale: true
    };
  }

  // Graceful confidence decay: full confidence up to 12s, then linear decay down to 25% at TTL
  let decayFactor = 1.0;
  if (ageMs > 12_000) {
    decayFactor = Math.max(0.25, 1.0 - (ageMs - 12_000) / (maxTtlMs - 12_000) * 0.75);
  }

  return {
    valid: true,
    ageMs,
    positionConfidence: Math.round(u.positionConfidence * decayFactor * 100) / 100,
    classConfidence: Math.round(u.classConfidence * decayFactor * 100) / 100,
    isStale: ageMs > 25_000
  };
}

/**
 * Convert UnifiedObservation to backward-compatible Observation
 */
export function toObservation(u: UnifiedObservation): Observation {
  const sourceKindMap: Record<SourceFamily, SourceKind> = {
    adsb: "adsb",
    radar: "radar",
    acoustic: "acoustic",
    optical: "optical",
    satellite: "satellite",
    alert: "alerts",
    weather: "weather",
    osint: "osint",
    manual: "manual",
    simulation: "simulation"
  };

  return {
    id: u.objectId ?? u.object_id ?? u.eventId ?? u.event_id,
    type: (u.objectType && u.objectType !== "unknown") ? u.objectType : (u.object_type ?? "unknown"),
    lat: u.lat,
    lon: u.lon,
    heading: u.heading,
    speed: u.speed,
    altitude: u.altitude,
    timestamp: u.observedAt ?? u.observed_at,
    source: sourceKindMap[u.sourceFamily ?? u.source_family ?? "adsb"] ?? "sdr",
    confidence: u.positionConfidence ?? u.confidence ?? 0.8,
    threatEvidence: u.threatEvidence,
    isSynthetic: u.isSynthetic ?? false,
    meta: {
      source_id: u.sourceId ?? u.source_id,
      source_family: u.sourceFamily ?? u.source_family,
      sensor_type: u.sensorType,
      measurement_accuracy: u.uncertaintyRadius ?? u.measurement_accuracy,
      uncertainty_radius: u.uncertaintyRadius,
      clock_offset: u.clockOffset,
      jitter: u.jitter,
      raw_evidence_hash: u.rawEvidenceHash,
      schema_version: u.schemaVersion,
      evidence: (u.evidence ?? []).join("; "),
      provenance: u.provenance,
      model: u.model ?? "",
      callsign: u.callsign ?? "",
      received_at: u.receivedAt ?? u.received_at,
      latency_ms: u.latency,
      isSynthetic: u.isSynthetic ?? false,
      isDegraded: u.isDegraded ?? false,
      ewFlags: (u.ewFlags || []).join(",")
    }
  };
}
