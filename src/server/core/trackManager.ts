import { bearingDegrees, destinationPoint, haversineMeters } from "../domain/geo.js";
import type { CompactTrackPacket, Observation, ThreatLevel, TrackState } from "../domain/types.js";
import { KalmanFilter2D } from "./kalman.js";
import { TrackCorrelator } from "./trackCorrelator.js";

interface InternalTrack {
  state: TrackState;
  filter: KalmanFilter2D;
  lastMeasurementTime: number;
  firstSeen: number;
  lastStationarySince?: number;
}

const STALE_AFTER_MS = 15_000; // 15 seconds without fresh measurement = target pruned immediately

function resolveRealisticModel(type: string, speedMs: number, providedModel?: string): string | undefined {
  if (type === "uav") {
    const speedKmh = speedMs * 3.6;
    if (speedKmh >= 235 || (providedModel && (providedModel.includes("238") || providedModel.includes("Jet")))) {
      return "Shahed-238 (Jet)";
    }
    if (speedKmh < 135 || (providedModel && (providedModel.includes("Supercam") || providedModel.includes("Orlan") || providedModel.includes("ZALA")))) {
      return providedModel || "Supercam S350 Recon";
    }
    return "Shahed-136";
  }
  return providedModel;
}

export class TrackManager {
  private readonly tracks = new Map<string, InternalTrack>();
  private readonly correlator = new TrackCorrelator();

  ingest(observation: Observation): TrackState | null {
    const now = Date.now();
    // Drop outdated observations (older than 20s) to prevent ghost resurrection
    if (now - observation.timestamp > 20_000) {
      return this.tracks.get(observation.id)?.state ?? null;
    }

    const activeList = this.snapshot();
    const correlation = this.correlator.findBestMatch(observation, activeList);

    const targetId = correlation.matchedTrackId ?? observation.id;
    const existing = this.tracks.get(targetId);

    if (!existing) {
      const filter = new KalmanFilter2D();
      const filtered = filter.update(observation.timestamp, observation.lat, observation.lon);
      const effectiveSpeed = observation.speed ?? 45;
      const initialModel = resolveRealisticModel(
        observation.type,
        effectiveSpeed,
        typeof observation.meta?.model === "string" ? observation.meta.model : undefined
      );

      const state: TrackState = {
        id: targetId,
        type: observation.type,
        lat: filtered.lat,
        lon: filtered.lon,
        heading: observation.heading ?? 0,
        speed: effectiveSpeed,
        timestamp: observation.timestamp,
        confidence: Math.min(1, observation.confidence + correlation.confidenceBonus),
        sources: new Set([observation.source]),
        altitude: observation.altitude,
        covLat: filtered.covLat,
        covLon: filtered.covLon,
        uncertaintyRadius: filtered.uncertaintyRadiusMeters,
        lastUpdated: now,
        model: initialModel,
        callsign: typeof observation.meta?.callsign === "string" ? observation.meta.callsign : undefined
      };

      this.tracks.set(targetId, { state, filter, lastMeasurementTime: now, firstSeen: now });
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

    const updatedModel = resolveRealisticModel(
      observation.type,
      updatedSpeed,
      typeof observation.meta?.model === "string" ? observation.meta.model : previous.model
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
      confidence: Math.round(updatedConfidence * 100) / 100,
      sources: mergedSources,
      covLat: filtered.covLat,
      covLon: filtered.covLon,
      uncertaintyRadius: Math.round(filtered.uncertaintyRadiusMeters),
      lastUpdated: now,
      model: updatedModel,
      callsign: typeof observation.meta?.callsign === "string" ? observation.meta.callsign : previous.callsign
    };

    return existing.state;
  }

  removeTrack(id: string): boolean {
    return this.tracks.delete(id);
  }

  tick(now = Date.now()): void {
    for (const [id, entry] of this.tracks.entries()) {
      const dt = Math.max(0, (now - entry.state.timestamp) / 1000);
      if (dt <= 0.1) {
        continue;
      }

      if (entry.state.speed > 2 && entry.state.heading !== undefined) {
        const dist = entry.state.speed * dt;
        const nextPos = destinationPoint(entry.state.lat, entry.state.lon, entry.state.heading, dist);
        entry.state.lat = Math.round(nextPos.lat * 1_000_000) / 1_000_000;
        entry.state.lon = Math.round(nextPos.lon * 1_000_000) / 1_000_000;
        entry.state.timestamp = now;
      }
    }
  }

  prune(now = Date.now()): void {
    for (const [id, entry] of this.tracks.entries()) {
      // 1. Stale measurement timeout (15 seconds without fresh measurement data)
      if (now - entry.lastMeasurementTime > STALE_AFTER_MS) {
        this.tracks.delete(id);
        continue;
      }

      const type = entry.state.type;
      const ageMs = now - entry.firstSeen;

      // 2. Maximum physical flight persistence limit per weapon/aircraft type
      const maxLifetimeMs =
        type === "bomb"
          ? 240_000 // 4 min max for glide bomb
          : type === "fpv"
          ? 360_000 // 6 min max for FPV quadcopter battery
          : type === "munition"
          ? 720_000 // 12 min max for cruise/ballistic missile flight phase
          : type === "uav"
          ? 2_400_000 // 40 min max for Shahed / recon drone in a single sector
          : 18_000_000; // 5 hours max for aircraft with active transponder

      if (ageMs > maxLifetimeMs) {
        this.tracks.delete(id);
        continue;
      }

      // 3. Stationary target detection: airborne weapons and tactical aircraft cannot hover motionless
      const isStationary = entry.state.speed < 4.0; // < 14 km/h
      if (isStationary) {
        if (!entry.lastStationarySince) {
          entry.lastStationarySince = now;
        }

        const stationaryDurationMs = now - entry.lastStationarySince;

        // Bombs, FPVs and missiles cannot hover at all
        if (type === "bomb" || type === "fpv" || type === "munition") {
          this.tracks.delete(id);
          continue;
        }

        // UAVs cannot stay stationary for > 45 seconds
        if (type === "uav" && stationaryDurationMs > 45_000) {
          this.tracks.delete(id);
          continue;
        }

        // Helicopters / aircraft stationary for > 90 seconds are grounded or invalid transponder
        if ((type === "helicopter" || type === "aircraft") && stationaryDurationMs > 90_000) {
          this.tracks.delete(id);
          continue;
        }
      } else {
        entry.lastStationarySince = undefined;
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
      Math.round(track.lat * 1_000_000) / 1_000_000,
      Math.round(track.lon * 1_000_000) / 1_000_000,
      Math.round(track.heading * 100) / 100,
      Math.round(track.speed * 100) / 100,
      track.timestamp,
      track.confidence,
      track.uncertaintyRadius,
      track.threatLevel,
      track.altitude,
      track.model,
      track.callsign
    ]);
  }
}
