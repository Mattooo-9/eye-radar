import type { Observation, TrackType } from "../domain/types.js";

export interface SdrPayload {
  id: string;
  type?: TrackType;
  lat: number;
  lon: number;
  heading?: number;
  speed?: number;
  timestamp?: number;
  confidence?: number;
  altitude?: number;
}

export const normalizeSdrPayload = (payload: SdrPayload): Observation => ({
  id: payload.id,
  type: payload.type ?? "unknown",
  lat: payload.lat,
  lon: payload.lon,
  heading: payload.heading,
  speed: payload.speed,
  timestamp: payload.timestamp ?? Date.now(),
  source: "sdr",
  confidence: payload.confidence ?? 0.82,
  altitude: payload.altitude
});
