import { bearingDegrees, haversineMeters } from "../domain/geo.js";
import type { ThreatLevel, TrackState, UserLocation } from "../domain/types.js";

export interface ThreatEvaluation {
  trackId: string;
  threatLevel: ThreatLevel;
  distanceMeters: number;
  etaMinutes: number | null;
  bearingToTarget: number;
  isHeadingTowards: boolean;
  warningMessage?: string;
}

export class ThreatEngine {
  /**
   * Evaluate single track threat relative to a specific location (user, city, shelter)
   */
  evaluateThreat(
    track: TrackState,
    targetLocation: UserLocation | { lat: number; lon: number }
  ): ThreatEvaluation {
    const distanceMeters = haversineMeters(
      track.lat,
      track.lon,
      targetLocation.lat,
      targetLocation.lon
    );
    const bearingToTarget = bearingDegrees(
      track.lat,
      track.lon,
      targetLocation.lat,
      targetLocation.lon
    );

    // Angular difference between object heading and line of sight to target
    const headingDiff = Math.abs(track.heading - bearingToTarget);
    const angularDiscrepancy = Math.min(headingDiff, 360 - headingDiff);

    // Is the target heading within a +/- 40 degree cone towards the user location?
    const isHeadingTowards = angularDiscrepancy <= 45;

    let etaMinutes: number | null = null;
    const speedMs = Math.max(track.speed, 20); // Fallback ~72 km/h for UAV if zero

    if (isHeadingTowards && speedMs > 0) {
      // Effective approach velocity
      const radialVelocity = speedMs * Math.cos((angularDiscrepancy * Math.PI) / 180);
      if (radialVelocity > 5) {
        etaMinutes = Math.round((distanceMeters / radialVelocity) / 60);
      }
    }

    let threatLevel: ThreatLevel = "low";
    let warningMessage: string | undefined;

    const distanceKm = Math.round(distanceMeters / 1000);

    if (isHeadingTowards) {
      if (distanceMeters <= 25_000) {
        threatLevel = "critical";
        warningMessage = `🚨 КРИТИЧНА НЕБЕЗПЕКА! ${this.formatTypeName(track.type)} на відстані ~${distanceKm} км, курс у ваш сектор. Орієнтовний час підльоту: ~${etaMinutes ?? 5} хв. Негайно в укриття!`;
      } else if (distanceMeters <= 50_000) {
        threatLevel = "high";
        warningMessage = `⚠️ УВАГА: ${this.formatTypeName(track.type)} на відстані ~${distanceKm} км, вектор руху у напрямку вашого району (ETA ~${etaMinutes ?? 15} хв). Підготуйтесь до укриття!`;
      } else if (distanceMeters <= 75_000) {
        threatLevel = "medium";
        warningMessage = `🟡 СПОСТЕРЕЖЕННЯ: ${this.formatTypeName(track.type)} в радіусі ~${distanceKm} км курсом у бік вашого сектору. Стежте за оновленнями.`;
      }
    } else if (distanceMeters <= 8_000) {
      threatLevel = "medium";
      warningMessage = `🟡 Поблизу виявлено ${this.formatTypeName(track.type)} (~${distanceKm} км), курс суміжний (${Math.round(track.heading)}°).`;
    }

    return {
      trackId: track.id,
      threatLevel,
      distanceMeters,
      etaMinutes,
      bearingToTarget,
      isHeadingTowards,
      warningMessage
    };
  }

  /**
   * Find most urgent threat for a given user
   */
  findHighestThreat(
    tracks: TrackState[],
    targetLocation: UserLocation | { lat: number; lon: number }
  ): ThreatEvaluation | null {
    if (tracks.length === 0) {
      return null;
    }

    const evaluations = tracks.map((t) => this.evaluateThreat(t, targetLocation));
    
    // Priority order: critical > high > medium > low, then smallest distance
    const levelScore: Record<ThreatLevel, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1
    };

    evaluations.sort((a, b) => {
      const scoreDiff = levelScore[b.threatLevel] - levelScore[a.threatLevel];
      if (scoreDiff !== 0) return scoreDiff;
      return a.distanceMeters - b.distanceMeters;
    });

    return evaluations[0] ?? null;
  }

  private formatTypeName(type: TrackState["type"]): string {
    switch (type) {
      case "uav":
        return "БПЛА / Дрон";
      case "munition":
        return "Крилата / балістична ракета";
      case "bomb":
        return "Керована авіабомба (КАБ)";
      case "fpv":
        return "Ударний FPV-дрон";
      case "aircraft":
        return "Літак";
      case "helicopter":
        return "Гелікоптер";
      default:
        return "Повітряна ціль";
    }
  }
}
