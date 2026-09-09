import { haversineMeters } from "../domain/geo.js";
import type { Observation, TrackState } from "../domain/types.js";

export interface CorrelationMatch {
  matchedTrackId: string | null;
  confidenceBonus: number;
}

export class TrackCorrelator {
  private readonly maxAssociationDistanceMeters: number;

  constructor(maxAssociationDistanceMeters = 35_000) {
    this.maxAssociationDistanceMeters = maxAssociationDistanceMeters;
  }

  findBestMatch(
    observation: Observation,
    activeTracks: TrackState[]
  ): CorrelationMatch {
    // If observation explicitly specifies an existing ID, check if it exists
    const directMatch = activeTracks.find((t) => t.id === observation.id);
    if (directMatch) {
      return { matchedTrackId: directMatch.id, confidenceBonus: 0.1 };
    }

    let bestTrack: TrackState | null = null;
    let minDistance = Infinity;

    for (const track of activeTracks) {
      // Don't correlate if types are fundamentally incompatible (e.g. aircraft vs munition)
      if (
        observation.type !== "unknown" &&
        track.type !== "unknown" &&
        observation.type !== track.type
      ) {
        continue;
      }

      const distance = haversineMeters(track.lat, track.lon, observation.lat, observation.lon);
      const timeDiffSec = Math.abs(observation.timestamp - track.timestamp) / 1000;

      // Allow distance gating to expand proportionally with target speed and time delta
      const allowedGate = Math.max(
        this.maxAssociationDistanceMeters,
        (track.speed || 50) * timeDiffSec + 10_000
      );

      if (distance < allowedGate && distance < minDistance) {
        // If both have heading, check directional compatibility
        if (
          typeof observation.heading === "number" &&
          typeof track.heading === "number"
        ) {
          const headingDiff = Math.abs(observation.heading - track.heading);
          const normalizedDiff = Math.min(headingDiff, 360 - headingDiff);
          if (normalizedDiff > 70) {
            // Divergent headings; likely different objects
            continue;
          }
        }

        minDistance = distance;
        bestTrack = track;
      }
    }

    if (bestTrack) {
      // Distinct independent source confirmation boosts confidence
      const isIndependentSource = !bestTrack.sources.has(observation.source);
      const confidenceBonus = isIndependentSource ? 0.2 : 0.05;

      return {
        matchedTrackId: bestTrack.id,
        confidenceBonus
      };
    }

    return {
      matchedTrackId: null,
      confidenceBonus: 0
    };
  }
}
