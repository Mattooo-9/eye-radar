import { bearingDegrees, destinationPoint, haversineMeters } from "../domain/geo.js";
import type { CompactTrackPacket, Observation, ThreatLevel, TrackLifecycle, TrackState } from "../domain/types.js";
import { ImmFilter2D } from "./immFilter.js";
import { classifyAerialObject } from "./classificationEngine.js";
import { TrackCorrelator } from "./trackCorrelator.js";

interface InternalTrack {
  state: TrackState;
  filter: ImmFilter2D;
  lastMeasurementTime: number;
  firstSeen: number;
  hitsCount: number;
  lastStationarySince?: number;
}

const STALE_AFTER_MS = 15_000; // 15 seconds without fresh measurement = target pruned immediately

export class TrackManager {
  private readonly tracks = new Map<string, InternalTrack>();
  private readonly correlator = new TrackCorrelator();

  ingest(observation: Observation, now = Date.now()): TrackState | null {
    // Drop outdated observations (older than 25s) to prevent ghost resurrection
    if (now - observation.timestamp > 25_000) {
      return this.tracks.get(observation.id)?.state ?? null;
    }

    const activeList = this.snapshot();
    const correlation = this.correlator.findBestMatch(observation, activeList);

    const targetId = correlation.matchedTrackId ?? observation.id;
    const existing = this.tracks.get(targetId);

    if (!existing) {
      const filter = new ImmFilter2D();
      const imm = filter.update(observation.timestamp, observation.lat, observation.lon);
      const effectiveSpeed = observation.speed ?? (imm.speedMs > 2 ? imm.speedMs : 45);
      const effectiveHeading = observation.heading ?? (imm.headingDeg || 0);

      const classification = classifyAerialObject({
        claimedType: observation.type,
        speedMs: effectiveSpeed,
        measuredSpeed: observation.speed,
        altitudeM: observation.altitude,
        measuredAltitude: observation.altitude,
        headingDeg: effectiveHeading,
        modelHint: typeof observation.meta?.model === "string" ? observation.meta.model : undefined,
        callsign: typeof observation.meta?.callsign === "string" ? observation.meta.callsign : undefined,
        sources: [observation.source],
        evidence: typeof observation.meta?.evidence === "string" ? [observation.meta.evidence] : undefined
      });

      // High-quality or multi-sensor source immediately becomes CONFIRMED; others start TENTATIVE
      const isHighConfidence = observation.confidence >= 0.88 || observation.source === "sdr" || observation.source === "simulation";
      const initialLifecycle: TrackLifecycle = isHighConfidence ? "CONFIRMED" : "TENTATIVE";

      const state: TrackState = {
        id: targetId,
        type: classification.resolvedType,
        lat: imm.lat,
        lon: imm.lon,
        heading: effectiveHeading,
        speed: effectiveSpeed,
        timestamp: observation.timestamp,
        confidence: Math.min(1, observation.confidence + correlation.confidenceBonus),
        sources: new Set([observation.source]),
        altitude: classification.estimatedAltitudeM,
        covLat: imm.covLat,
        covLon: imm.covLon,
        uncertaintyRadius: imm.uncertaintyRadiusMeters,
        lastUpdated: now,
        model: classification.resolvedModel,
        callsign: typeof observation.meta?.callsign === "string" ? observation.meta.callsign : undefined,
        lifecycle: initialLifecycle,
        measuredSpeed: classification.isMeasuredSpeed ? observation.speed : undefined,
        measuredAltitude: classification.isMeasuredAltitude ? observation.altitude : undefined,
        evidence: classification.evidence,
        propulsion: classification.propulsion
      };

      this.tracks.set(targetId, {
        state,
        filter,
        lastMeasurementTime: now,
        firstSeen: now,
        hitsCount: 1
      });
      return state;
    }

    // Existing track: perform IMM update & multi-sensor fusion
    const previous = existing.state;
    const imm = existing.filter.update(observation.timestamp, observation.lat, observation.lon);
    existing.hitsCount += 1;

    const elapsedSeconds = Math.max((observation.timestamp - previous.timestamp) / 1000, 0.5);
    const distanceMeters = haversineMeters(previous.lat, previous.lon, imm.lat, imm.lon);
    const derivedHeading = distanceMeters > 40
      ? bearingDegrees(previous.lat, previous.lon, imm.lat, imm.lon)
      : (imm.headingDeg || previous.heading);
    const derivedSpeed = distanceMeters / elapsedSeconds;

    const updatedSpeed = observation.speed ?? (derivedSpeed > 10 && derivedSpeed < 1100 ? derivedSpeed : (imm.speedMs || previous.speed));
    const updatedHeading = observation.heading ?? derivedHeading;

    const mergedSources = new Set([...previous.sources, observation.source]);
    const sourceDiversityBonus = mergedSources.size > 1 ? 0.15 : 0;
    const updatedConfidence = Math.min(
      0.99,
      previous.confidence * 0.4 + observation.confidence * 0.5 + sourceDiversityBonus
    );

    const classification = classifyAerialObject({
      claimedType: observation.type !== "unknown" ? observation.type : previous.type,
      speedMs: updatedSpeed,
      measuredSpeed: observation.speed ?? previous.measuredSpeed,
      altitudeM: observation.altitude ?? previous.altitude,
      measuredAltitude: observation.altitude ?? previous.measuredAltitude,
      headingDeg: updatedHeading,
      modelHint: typeof observation.meta?.model === "string" ? observation.meta.model : previous.model,
      callsign: typeof observation.meta?.callsign === "string" ? observation.meta.callsign : previous.callsign,
      sources: Array.from(mergedSources),
      evidence: previous.evidence
    });

    // Lifecycle promotion: 2 hits confirms tentative tracks
    const updatedLifecycle: TrackLifecycle = existing.hitsCount >= 2 ? "CONFIRMED" : previous.lifecycle || "CONFIRMED";

    existing.lastMeasurementTime = now;
    existing.state = {
      ...previous,
      type: classification.resolvedType,
      lat: imm.lat,
      lon: imm.lon,
      heading: Math.round(updatedHeading * 10) / 10,
      speed: Math.round(updatedSpeed * 10) / 10,
      altitude: classification.estimatedAltitudeM,
      timestamp: observation.timestamp,
      confidence: Math.round(updatedConfidence * 100) / 100,
      sources: mergedSources,
      covLat: imm.covLat,
      covLon: imm.covLon,
      uncertaintyRadius: Math.round(imm.uncertaintyRadiusMeters),
      lastUpdated: now,
      model: classification.resolvedModel,
      callsign: typeof observation.meta?.callsign === "string" ? observation.meta.callsign : previous.callsign,
      lifecycle: updatedLifecycle,
      measuredSpeed: classification.isMeasuredSpeed ? (observation.speed ?? previous.measuredSpeed) : undefined,
      measuredAltitude: classification.isMeasuredAltitude ? (observation.altitude ?? previous.measuredAltitude) : undefined,
      evidence: classification.evidence,
      propulsion: classification.propulsion
    };

    return existing.state;
  }

  removeTrack(id: string): boolean {
    return this.tracks.delete(id);
  }

  tick(now = Date.now()): void {
    for (const [, entry] of this.tracks.entries()) {
      const dt = Math.max(0, (now - entry.state.timestamp) / 1000);
      const timeSinceLastMeasurement = now - entry.lastMeasurementTime;

      // Lifecycle status transitions
      if (timeSinceLastMeasurement > 5_000 && entry.state.lifecycle === "CONFIRMED") {
        entry.state.lifecycle = "COASTING";
      } else if (timeSinceLastMeasurement > 12_000 && entry.state.lifecycle === "COASTING") {
        entry.state.lifecycle = "STALE";
      }

      if (dt <= 0.1) {
        continue;
      }

      // Kinematic dead-reckoning extrapolation
      if (entry.state.speed > 2 && entry.state.heading !== undefined) {
        const dist = entry.state.speed * dt;
        const nextPos = destinationPoint(entry.state.lat, entry.state.lon, entry.state.heading, dist);
        entry.state.lat = Math.round(nextPos.lat * 1_000_000) / 1_000_000;
        entry.state.lon = Math.round(nextPos.lon * 1_000_000) / 1_000_000;
        entry.state.timestamp = now;

        // Coasting targets slightly increase uncertainty radius
        if (entry.state.lifecycle === "COASTING" && entry.state.uncertaintyRadius) {
          entry.state.uncertaintyRadius = Math.min(8000, entry.state.uncertaintyRadius + Math.round(dt * 15));
        }
      }
    }
  }

  prune(now = Date.now()): void {
    for (const [id, entry] of this.tracks.entries()) {
      const measurementAge = now - entry.lastMeasurementTime;

      // 1. Drop unconfirmed tentative tracks if no follow-up hit within 10s
      if (entry.state.lifecycle === "TENTATIVE" && measurementAge > 10_000) {
        this.tracks.delete(id);
        continue;
      }

      // 2. Stale measurement timeout (15 seconds without fresh measurement data)
      if (measurementAge > STALE_AFTER_MS) {
        this.tracks.delete(id);
        continue;
      }

      const type = entry.state.type;
      const ageMs = now - entry.firstSeen;

      // 3. Maximum physical flight persistence limit per weapon/aircraft type
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

      // 4. Stationary target detection: airborne weapons and tactical aircraft cannot hover motionless
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
    return this.snapshot()
      .filter((track) => track.lifecycle !== "TENTATIVE" || track.confidence >= 0.85)
      .map((track) => [
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
