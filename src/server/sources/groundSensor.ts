import { createUnifiedObservation, type UnifiedObservation } from "../domain/unifiedObservation.js";
import type { Source } from "./sourceInterface.js";
import type { TrackType } from "../domain/types.js";

export interface GroundSensorDetection {
  detectionId: string;
  sensorId: string;
  sensorType: "ground_radar" | "acoustic" | "optical_tracker";
  timestamp: number;
  lat: number;
  lon: number;
  altitudeMeters?: number;
  speedMs?: number;
  headingDeg?: number;
  targetType: TrackType | "unknown";
  confidence: number;
  rcsM2?: number;
  soundLevelDb?: number;
  azimuthDeg?: number;
}

export interface GroundSensorPayload {
  version: string;
  timestamp: number;
  networkId: string;
  detections: GroundSensorDetection[];
}

export function validateGroundSensorPacket(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as GroundSensorPayload;
  if (typeof p.timestamp !== "number" || p.timestamp <= 0) return false;
  if (!Array.isArray(p.detections)) return false;
  if (p.detections.length === 0) return true;

  const sample = p.detections[0];
  if (!sample || typeof sample !== "object") return false;
  if (typeof sample.lat !== "number" || typeof sample.lon !== "number") return false;
  if (sample.lat < -90 || sample.lat > 90 || sample.lon < -180 || sample.lon > 180) return false;
  if (typeof sample.sensorId !== "string" || sample.sensorId.length === 0) return false;
  return true;
}

export class GroundSensorSource implements Source {
  name = "ground.sensor";
  private endpointUrl: string | null;
  private lastFetch = 0;
  private cache: UnifiedObservation[] = [];
  private memoryDetections: GroundSensorDetection[] = [];

  constructor(endpointUrl?: string) {
    this.endpointUrl = endpointUrl || process.env.GROUND_SENSOR_URL || null;
  }

  setEndpoint(url: string): void {
    this.endpointUrl = url;
  }

  /**
   * Ingest direct empirical sensor packet into ground sensor provider
   */
  ingestDirectPacket(payload: GroundSensorPayload): boolean {
    if (!validateGroundSensorPacket(payload)) return false;
    this.memoryDetections = payload.detections;
    this.lastFetch = 0; // invalidate cache
    return true;
  }

  isConfigured(): boolean {
    return Boolean(this.endpointUrl || this.memoryDetections.length > 0);
  }

  async fetchTracks(): Promise<UnifiedObservation[]> {
    const now = Date.now();
    if (now - this.lastFetch < 3000 && this.cache.length > 0) {
      return this.cache;
    }

    let detections = [...this.memoryDetections];

    if (this.endpointUrl) {
      try {
        const res = await fetch(this.endpointUrl, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(2000)
        });
        if (res.ok) {
          const payload = (await res.json()) as GroundSensorPayload;
          if (validateGroundSensorPacket(payload)) {
            detections = payload.detections;
          }
        }
      } catch {
        // Tolerated
      }
    }

    const observations: UnifiedObservation[] = [];
    for (const d of detections) {
      if (d.lat >= 43 && d.lat <= 54 && d.lon >= 22 && d.lon <= 42) {
        const family = d.sensorType === "acoustic" ? "acoustic" : "radar";
        // Realistic uncertainty radius: acoustic arrays have wide area (12km), optical tracker (250m), radar (35m)
        const accuracy = d.sensorType === "ground_radar" ? 35 : d.sensorType === "optical_tracker" ? 250 : 12_000;
        const confidence = d.sensorType === "acoustic"
          ? Math.min(0.45, Math.max(0.2, d.confidence))
          : Math.min(0.95, Math.max(0.3, d.confidence));
        
        // Never fabricate confirmed combat classes without corroboration
        const resolvedType = d.sensorType === "acoustic" ? "unknown" : d.targetType;
        const model = d.sensorType === "acoustic"
          ? "Непідтверджена повітряна ціль (акустичний контакт)"
          : d.sensorType === "optical_tracker"
          ? (d.targetType === "uav" ? "БПЛА (оптичний контакт)" : "Повітряна ціль")
          : (d.targetType === "uav" ? "БПЛА (радіолокація)" : "TARGET");

        const evidence = [
          `sensor_${d.sensorId}`,
          `type_${d.sensorType}`,
          d.rcsM2 !== undefined ? `rcs_${d.rcsM2}m2` : undefined,
          d.soundLevelDb !== undefined ? `sound_${d.soundLevelDb}dB` : undefined
        ].filter(Boolean) as string[];

        observations.push(
          createUnifiedObservation({
            source_id: `ground.${d.sensorType}`,
            source_family: family,
            event_id: `gnd-${d.sensorId}-${d.timestamp}`,
            object_id: d.detectionId,
            observed_at: d.timestamp,
            published_at: d.timestamp,
            received_at: now,
            lat: d.lat,
            lon: d.lon,
            speed: d.speedMs,
            heading: d.headingDeg,
            altitude: d.altitudeMeters,
            object_type: resolvedType,
            measurement_accuracy: accuracy,
            source_quality: d.sensorType === "ground_radar" ? 0.95 : 0.70,
            confidence,
            evidence,
            provenance: `Tactical Ground Sensor [${d.sensorType.toUpperCase()}]`,
            model
          })
        );
      }
    }

    this.cache = observations;
    this.lastFetch = now;
    return observations;
  }
}
