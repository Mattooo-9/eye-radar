import { bearingDegrees, haversineMeters } from "../domain/geo.js";
import type { CompactTrackPacket, Observation, ThreatLevel, TrackState } from "../domain/types.js";
import { KalmanFilter2D } from "./kalman.js";
import { TrackCorrelator } from "./trackCorrelator.js";

interface InternalTrack {
  state: TrackState;
  filter: KalmanFilter2D;
  lastMeasurementTime: number;
}

const STALE_AFTER_MS = 45_000; // 45 seconds without measurement = target lost / pruned

export class TrackManager {
  private readonly tracks = new Map<string, InternalTrack>();
  private readonly correlator = new TrackCorrelator();

  ingest(observation: Observation): TrackState {
    const activeList = this.snapshot();
    const correlation = this.correlator.findBestMatch(observation, activeList);

    const targetId = correlation.matchedTrackId ?? observation.id;
    const existing = this.tracks.get(targetId);
    const now = Date.now();

    if (!existing) {
      const filter = new KalmanFilter2D();
      const filtered = filter.update(observation.timestamp, observation.lat, observation.lon);
      const state: TrackState = {
        id: targetId,
        type: observation.type,
        lat: filtered.lat,
        lon: filtered.lon,
        heading: observation.heading ?? 0,
        speed: observation.speed ?? 45, // default ~160 km/h for typical drone if unknown
        timestamp: observation.timestamp,
        confidence: Math.min(1, observation.confidence + correlation.confidenceBonus),
        sources: new Set([observation.source]),
        altitude: observation.altitude,
        covLat: filtered.covLat,
        covLon: filtered.covLon,
        uncertaintyRadius: filtered.uncertaintyRadiusMeters,
        lastUpdated: now
      };

      this.tracks.set(targetId, { state, filter, lastMeasurementTime: now });
      return state;
    }

    const previous = existing.state;
    const filtered = existing.filter.update(observation.timestamp, observation.lat, observation.lon);
    const elapsedSeconds = Math.max((observation.timestamp - previous.timestamp) / 1000, 0.5);
    const distanceMeters = haversineMeters(previous.lat, previous.lon, filtered.lat, filtered.lon);
    const derivedHeading = distanceMeters > 50
      ? bearingDegrees(previous.lat, previous.lon, filtered.lat, filtered.lon)
      : previous.heading;
    const derivedSpeed = distanceMeters / elapsedSeconds;

    const updatedSpeed = observation.speed ?? (derivedSpeed > 10 && derivedSpeed < 1000 ? derivedSpeed : previous.speed);
    const updatedHeading = observation.heading ?? derivedHeading;

    const mergedSources = new Set([...previous.sources, observation.source]);
    const sourceDiversityBonus = mergedSources.size > 1 ? 0.15 : 0;
    const updatedConfidence = Math.min(
      0.99,
      previous.confidence * 0.4 + observation.confidence * 0.5 + sourceDiversityBonus
    );

    existing.lastMeasurementTime = now;
    existing.state = {
      ...previous,
      lat: filtered.lat,
      lon: filtered.lon,
      heading: updatedHeading,
      speed: updatedSpeed,
      altitude: observation.altitude ?? previous.altitude,
      timestamp: observation.timestamp,
      confidence: Number(updatedConfidence.toFixed(2)),
      sources: mergedSources,
      covLat: filtered.covLat,
      covLon: filtered.covLon,
      uncertaintyRadius: Math.round(filtered.uncertaintyRadiusMeters),
      lastUpdated: now
    };

    return existing.state;
  }

  tick(now = Date.now()): void {
    for (const [id, entry] of this.tracks.entries()) {
      const ageMs = now - entry.lastMeasurementTime;

      // 1. Hard purge if no fresh measurements arrived within 45s
      if (ageMs > STALE_AFTER_MS) {
        this.tracks.delete(id);
        continue;
      }

      // 2. Smooth Kalman dead-reckoning extrapolation (strictly bounded to 20s max)
      if (ageMs >= 1500 && ageMs <= 20_000) {
        const predicted = entry.filter.predict(now);
        if (predicted) {
          entry.state.lat = predicted.lat;
          entry.state.lon = predicted.lon;
          entry.state.covLat = predicted.covLat;
          entry.state.covLon = predicted.covLon;
          entry.state.uncertaintyRadius = Math.round(predicted.uncertaintyRadiusMeters);
          entry.state.lastUpdated = now;
        }
      }
    }
  }

  prune(now = Date.now()): void {
    for (const [id, entry] of this.tracks.entries()) {
      if (now - entry.lastMeasurementTime > STALE_AFTER_MS) {
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
      track.timestamp,
      track.confidence,
      track.uncertaintyRadius,
      track.threatLevel,
      track.altitude
    ]);
  }
}
