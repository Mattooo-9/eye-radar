import { destinationPoint, haversineMeters } from "../domain/geo.js";
import type { Observation, TrackState } from "../domain/types.js";

export interface CorrelationMatch {
  matchedTrackId: string | null;
  confidenceBonus: number;
  mahalanobisDistance?: number;
}

export class TrackCorrelator {
  private readonly maxAssociationDistanceMeters: number;
  private readonly chiSquareGateThreshold = 9.21; // 99% confidence threshold for 2-DOF chi-square distribution

  constructor(maxAssociationDistanceMeters = 35_000) {
    this.maxAssociationDistanceMeters = maxAssociationDistanceMeters;
  }

  /**
   * Calculates Mahalanobis distance between track state and new observation
   */
  calculateMahalanobisDistance(track: TrackState, obs: Observation): number {
    const latMeters = (obs.lat - track.lat) * 111_139;
    const lonMeters = (obs.lon - track.lon) * 111_139 * Math.cos((track.lat * Math.PI) / 180);

    // Track uncertainty in meters squared
    const trackVarMetersSq = Math.max(200 ** 2, (track.uncertaintyRadius || 500) ** 2);
    // Observation measurement accuracy in meters squared
    const obsAccuracy =
      typeof obs.meta?.measurement_accuracy === "number"
        ? (obs.meta.measurement_accuracy as number)
        : 500;
    const obsVarMetersSq = Math.max(50 ** 2, obsAccuracy ** 2);

    const totalVar = trackVarMetersSq + obsVarMetersSq;
    const dSq = (latMeters ** 2 + lonMeters ** 2) / totalVar;
    return Math.sqrt(dSq);
  }

  findBestMatch(
    observation: Observation,
    activeTracks: TrackState[]
  ): CorrelationMatch {
    // 1. If observation explicitly specifies an existing ID, check if it exists
    const directMatch = activeTracks.find((t) => t.id === observation.id);
    if (directMatch) {
      return { matchedTrackId: directMatch.id, confidenceBonus: 0.1, mahalanobisDistance: 0 };
    }

    let bestTrack: TrackState | null = null;
    let minDistance = Infinity;
    let bestMahalanobis = Infinity;

    for (const track of activeTracks) {
      // 2. Type compatibility gating: fundamentally different types cannot merge (e.g. aircraft vs munition)
      if (
        observation.type !== "unknown" &&
        track.type !== "unknown" &&
        observation.type !== track.type
      ) {
        continue;
      }

      const timeDiffSec = Math.abs(observation.timestamp - track.timestamp) / 1000;

      // 3. Speed compatibility gating: reject sudden impossible acceleration jumps
      if (
        typeof observation.speed === "number" &&
        typeof track.speed === "number" &&
        timeDiffSec < 20
      ) {
        const speedDiff = Math.abs(observation.speed - track.speed);
        if (speedDiff > 80) {
          // > 288 km/h speed difference within 20s
          continue;
        }
      }

      // 4. Altitude compatibility gating: reject unrealistic altitude teleports
      if (
        typeof observation.altitude === "number" &&
        typeof track.altitude === "number" &&
        timeDiffSec < 20
      ) {
        const altDiff = Math.abs(observation.altitude - track.altitude);
        if (altDiff > 2500) {
          // > 2500m altitude difference
          continue;
        }
      }

      // 5. Kinematic forward extrapolation: where was this track expected to be?
      let referenceLat = track.lat;
      let referenceLon = track.lon;
      if (track.speed > 2 && typeof track.heading === "number" && timeDiffSec > 0.4 && timeDiffSec < 30) {
        const extrapolated = destinationPoint(track.lat, track.lon, track.heading, track.speed * timeDiffSec);
        referenceLat = extrapolated.lat;
        referenceLon = extrapolated.lon;
      }

      const distance = haversineMeters(referenceLat, referenceLon, observation.lat, observation.lon);

      // Spatial gating threshold based on speed and time delta
      const allowedGate = Math.max(
        this.maxAssociationDistanceMeters,
        (track.speed || 50) * timeDiffSec + 10_000
      );

      if (distance > allowedGate) {
        continue;
      }

      // 6. Mahalanobis distance gating (statistical covariance ellipsoid containment)
      const mahaDist = this.calculateMahalanobisDistance(track, observation);
      const mahaSq = mahaDist ** 2;

      // Reject if outside dynamic chi-square gate
      if (timeDiffSec < 10 && mahaSq > this.chiSquareGateThreshold * 2.5) {
        continue;
      }

      // 7. Directional compatibility gating: crossing tracks heading separation
      if (
        typeof observation.heading === "number" &&
        typeof track.heading === "number"
      ) {
        const headingDiff = Math.abs(observation.heading - track.heading);
        const normalizedDiff = Math.min(headingDiff, 360 - headingDiff);
        if (normalizedDiff > 70) {
          // Divergent headings; likely separate crossing objects
          continue;
        }
      }

      if (distance < minDistance) {
        minDistance = distance;
        bestMahalanobis = mahaDist;
        bestTrack = track;
      }
    }

    if (bestTrack) {
      // Distinct independent source confirmation boosts confidence
      const isIndependentSource = !bestTrack.sources.has(observation.source);
      const confidenceBonus = isIndependentSource ? 0.2 : 0.05;

      return {
        matchedTrackId: bestTrack.id,
        confidenceBonus,
        mahalanobisDistance: Math.round(bestMahalanobis * 100) / 100
      };
    }

    return {
      matchedTrackId: null,
      confidenceBonus: 0
    };
  }
}

