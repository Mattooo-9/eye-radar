import { createUnifiedObservation, type UnifiedObservation } from "../domain/unifiedObservation.js";
import type { Source } from "./sourceInterface.js";

export interface SatelliteCoordinateRecord {
  recordId: string;
  constellation: string;
  sensorType: "SAR" | "Optical" | "Thermal";
  timestamp: number;
  lat: number;
  lon: number;
  estimatedSpeedMs?: number;
  estimatedHeadingDeg?: number;
  confidence: number;
  detectionType: "vessel" | "aircraft" | "thermal_anomaly";
}

export interface SatelliteCoordinatePayload {
  passId: string;
  timestamp: number;
  satellite: string;
  detections: SatelliteCoordinateRecord[];
}

export function validateSatellitePacket(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as SatelliteCoordinatePayload;
  if (typeof p.timestamp !== "number" || p.timestamp <= 0) return false;
  if (typeof p.satellite !== "string" || p.satellite.length === 0) return false;
  if (!Array.isArray(p.detections)) return false;
  if (p.detections.length === 0) return true;

  const sample = p.detections[0];
  if (!sample || typeof sample !== "object") return false;
  if (typeof sample.lat !== "number" || typeof sample.lon !== "number") return false;
  if (sample.lat < -90 || sample.lat > 90 || sample.lon < -180 || sample.lon > 180) return false;
  return true;
}

export class SatelliteCoordinateSource implements Source {
  name = "satellite.eo_coords";
  private memoryRecords: SatelliteCoordinateRecord[] = [];
  private lastFetch = 0;
  private cache: UnifiedObservation[] = [];

  ingestDirectPacket(payload: SatelliteCoordinatePayload): boolean {
    if (!validateSatellitePacket(payload)) return false;
    this.memoryRecords = payload.detections;
    this.lastFetch = 0;
    return true;
  }

  isConfigured(): boolean {
    return this.memoryRecords.length > 0;
  }

  async fetchTracks(): Promise<UnifiedObservation[]> {
    const now = Date.now();
    if (now - this.lastFetch < 10000 && this.cache.length > 0) {
      return this.cache;
    }

    const observations: UnifiedObservation[] = [];
    for (const rec of this.memoryRecords) {
      if (rec.lat >= 43 && rec.lat <= 54 && rec.lon >= 22 && rec.lon <= 42) {
        observations.push(
          createUnifiedObservation({
            source_id: `satellite.${rec.sensorType.toLowerCase()}`,
            source_family: "optical",
            event_id: `sat-${rec.recordId}-${rec.timestamp}`,
            object_id: `sat-${rec.recordId}`,
            observed_at: rec.timestamp,
            published_at: rec.timestamp,
            received_at: now,
            lat: rec.lat,
            lon: rec.lon,
            speed: rec.estimatedSpeedMs,
            heading: rec.estimatedHeadingDeg,
            object_type: rec.detectionType === "aircraft" ? "aircraft" : "unknown",
            measurement_accuracy: rec.sensorType === "SAR" ? 60 : 300,
            source_quality: 0.94,
            confidence: Math.min(1, Math.max(0.1, rec.confidence)),
            evidence: [
              `satellite_${rec.constellation}`,
              `sensor_${rec.sensorType}`,
              `detection_${rec.detectionType}`
            ],
            provenance: `Satellite EO Direct [${rec.constellation} ${rec.sensorType}]`,
            model: "SATELLITE_EO_DETECTION"
          })
        );
      }
    }

    this.cache = observations;
    this.lastFetch = now;
    return observations;
  }
}
