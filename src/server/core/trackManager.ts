import { bearingDegrees, haversineMeters } from "../domain/geo.js";
import type { CompactTrackPacket, Observation, TrackState } from "../domain/types.js";
import { KalmanFilter2D } from "./kalman.js";

interface InternalTrack {
  state: TrackState;
  filter: KalmanFilter2D;
}

const STALE_AFTER_MS = 45_000;

export class TrackManager {
  private readonly tracks = new Map<string, InternalTrack>();

  ingest(observation: Observation): TrackState {
    const existing = this.tracks.get(observation.id);

    if (!existing) {
      const filter = new KalmanFilter2D();
      const filtered = filter.update(observation.timestamp, observation.lat, observation.lon);
      const state: TrackState = {
        id: observation.id,
        type: observation.type,
        lat: filtered.lat,
        lon: filtered.lon,
        heading: observation.heading ?? 0,
        speed: observation.speed ?? 0,
        timestamp: observation.timestamp,
        confidence: observation.confidence,
        sources: new Set([observation.source]),
        altitude: observation.altitude
      };

      this.tracks.set(observation.id, { state, filter });
      return state;
    }

    const previous = existing.state;
    const filtered = existing.filter.update(observation.timestamp, observation.lat, observation.lon);
    const elapsedSeconds = Math.max((observation.timestamp - previous.timestamp) / 1000, 1);
    const distanceMeters = haversineMeters(previous.lat, previous.lon, filtered.lat, filtered.lon);
    const derivedHeading = bearingDegrees(previous.lat, previous.lon, filtered.lat, filtered.lon);
    const derivedSpeed = distanceMeters / elapsedSeconds;

    existing.state = {
      id: observation.id,
      type: observation.type || previous.type,
      lat: filtered.lat,
      lon: filtered.lon,
      heading: observation.heading ?? derivedHeading,
      speed: observation.speed ?? derivedSpeed,
      timestamp: observation.timestamp,
      confidence: Math.min(1, previous.confidence * 0.4 + observation.confidence * 0.6),
      sources: new Set([...previous.sources, observation.source]),
      altitude: observation.altitude ?? previous.altitude
    };

    return existing.state;
  }

  prune(now = Date.now()): void {
    for (const [id, track] of this.tracks.entries()) {
      if (now - track.state.timestamp > STALE_AFTER_MS) {
        this.tracks.delete(id);
      }
    }
  }

  snapshot(): TrackState[] {
    return [...this.tracks.values()].map((entry) => entry.state);
  }

  toPackets(): CompactTrackPacket[] {
    return this.snapshot().map((track) => [
      track.id,
      track.type,
      Number(track.lat.toFixed(6)),
      Number(track.lon.toFixed(6)),
      Number(track.heading.toFixed(2)),
      Number(track.speed.toFixed(2)),
      track.timestamp
    ]);
  }
}
