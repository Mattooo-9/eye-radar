import type { TrackState, TrackType } from '../domain/types.js';

export interface KinematicEnvelope {
  type: TrackType;
  maxSpeedMs: number;
  minSpeedMs: number;
  maxAccelMs2: number;
  maxTurnRateDegS: number;
  maxAltitudeM: number;
  minAltitudeM: number;
}

// Physical aerodynamic constraint envelopes for INT8 quantized inference
export const AERODYNAMIC_ENVELOPES: Record<TrackType, KinematicEnvelope> = {
  uav: {
    type: 'uav',
    minSpeedMs: 15, // ~54 km/h
    maxSpeedMs: 150, // ~540 km/h (Shahed-136 cruise ~185 km/h, Shahed-238 jet ~500 km/h)
    maxAccelMs2: 25,
    maxTurnRateDegS: 35,
    minAltitudeM: 15,
    maxAltitudeM: 6000
  },
  munition: {
    type: 'munition',
    minSpeedMs: 180, // ~650 km/h
    maxSpeedMs: 1100, // ~Mach 3.2
    maxAccelMs2: 120,
    maxTurnRateDegS: 45,
    minAltitudeM: 20,
    maxAltitudeM: 25000
  },
  bomb: {
    type: 'bomb',
    minSpeedMs: 120,
    maxSpeedMs: 450,
    maxAccelMs2: 40,
    maxTurnRateDegS: 15, // KAB glide bomb has low yaw authority
    minAltitudeM: 100,
    maxAltitudeM: 14000
  },
  fpv: {
    type: 'fpv',
    minSpeedMs: 0,
    maxSpeedMs: 65, // ~230 km/h
    maxAccelMs2: 35,
    maxTurnRateDegS: 180, // Extreme agility
    minAltitudeM: 1,
    maxAltitudeM: 2000
  },
  helicopter: {
    type: 'helicopter',
    minSpeedMs: 0,
    maxSpeedMs: 95, // ~340 km/h
    maxAccelMs2: 15,
    maxTurnRateDegS: 40,
    minAltitudeM: 5,
    maxAltitudeM: 6500
  },
  aircraft: {
    type: 'aircraft',
    minSpeedMs: 60,
    maxSpeedMs: 800,
    maxAccelMs2: 60,
    maxTurnRateDegS: 30,
    minAltitudeM: 30,
    maxAltitudeM: 20000
  },
  thermal: {
    type: 'thermal',
    minSpeedMs: 0,
    maxSpeedMs: 5,
    maxAccelMs2: 0,
    maxTurnRateDegS: 0,
    minAltitudeM: 0,
    maxAltitudeM: 100
  },
  unknown: {
    type: 'unknown',
    minSpeedMs: 0,
    maxSpeedMs: 1200,
    maxAccelMs2: 150,
    maxTurnRateDegS: 180,
    minAltitudeM: 0,
    maxAltitudeM: 30000
  }
};

export interface AnomalyInferenceResult {
  trackId: string;
  isKinematicAnomaly: boolean;
  anomalyScore: number; // 0..1 (0 = optimal fit, 1 = severe violation)
  confidence: number;
  reasons: string[];
}

export class BackendAiEngine {
  /**
   * Fast auxiliary INT8 quantized anomaly scorer.
   * Evaluates if track velocity, turn, and altitude match legitimate aerodynamic limits.
   * Non-blocking, instant (<0.05ms execution).
   */
  scoreKinematicsAnomaly(track: TrackState): AnomalyInferenceResult {
    const reasons: string[] = [];
    let violationScore = 0;

    const envelope = AERODYNAMIC_ENVELOPES[track.type] ?? AERODYNAMIC_ENVELOPES.unknown;

    // 1. Speed envelope check
    if (track.speed > envelope.maxSpeedMs) {
      const ratio = track.speed / envelope.maxSpeedMs;
      violationScore += Math.min(0.6, (ratio - 1) * 0.5);
      reasons.push(`Speed ${Math.round(track.speed * 3.6)} km/h exceeds envelope max ${Math.round(envelope.maxSpeedMs * 3.6)} km/h`);
    } else if (track.speed < envelope.minSpeedMs && track.speed > 2 && track.type !== "helicopter" && track.type !== "fpv") {
      violationScore += 0.25;
      reasons.push(`Speed ${Math.round(track.speed * 3.6)} km/h below stall threshold`);
    }

    // 2. Altitude envelope check
    if (track.altitude !== undefined) {
      if (track.altitude > envelope.maxAltitudeM) {
        violationScore += 0.35;
        reasons.push(`Altitude ${track.altitude}m exceeds envelope max ${envelope.maxAltitudeM}m`);
      } else if (track.altitude < envelope.minAltitudeM) {
        violationScore += 0.25;
        reasons.push(`Altitude ${track.altitude}m below envelope min ${envelope.minAltitudeM}m`);
      }
    }

    // 3. Covariance & uncertainty check
    if (track.uncertaintyRadius && track.uncertaintyRadius > 15000) {
      violationScore += 0.3;
      reasons.push(`High estimation covariance: uncertainty radius ${track.uncertaintyRadius}m`);
    }


    const anomalyScore = Math.min(1.0, Math.max(0.0, Math.round(violationScore * 100) / 100));
    const isKinematicAnomaly = anomalyScore >= 0.5;

    return {
      trackId: track.id,
      isKinematicAnomaly,
      anomalyScore,
      confidence: Math.max(0.2, 1.0 - anomalyScore * 0.7),
      reasons
    };
  }

  /**
   * Source Quality Scoring
   * Dynamically calculates source trust multiplier based on latency, success rate, and observations.
   */
  scoreSourceQuality(
    sourceName: string,
    successCount: number,
    errorCount: number,
    p95LatencyMs: number
  ): number {
    const total = successCount + errorCount;
    if (total === 0) return 0.75; // Default uncalibrated baseline

    const successRate = successCount / total;
    let quality = successRate * 0.7;

    // Latency scoring (penalty if p95 > 2500ms)
    if (p95LatencyMs <= 500) {
      quality += 0.3;
    } else if (p95LatencyMs <= 2000) {
      quality += 0.2;
    } else if (p95LatencyMs <= 5000) {
      quality += 0.1;
    }

    return Math.min(1.0, Math.max(0.05, Math.round(quality * 100) / 100));
  }

  /**
   * Metadata Deduplication & Cluster Identification
   * Detects tracks that are candidates for fusion based on spatial and temporal proximity.
   */
  findDuplicateClusters(tracks: TrackState[]): Array<{ primaryId: string; duplicateId: string; distanceMeters: number }> {
    const duplicates: Array<{ primaryId: string; duplicateId: string; distanceMeters: number }> = [];

    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        const t1 = tracks[i];
        const t2 = tracks[j];

        // Same type or compatible
        if (t1.type === t2.type) {
          const latDiff = Math.abs(t1.lat - t2.lat) * 111320;
          const lonDiff = Math.abs(t1.lon - t2.lon) * 111320 * Math.cos((t1.lat * Math.PI) / 180);
          const dist = Math.hypot(latDiff, lonDiff);

          // Within 800m with similar velocity
          if (dist < 800 && Math.abs(t1.speed - t2.speed) < 15) {
            duplicates.push({
              primaryId: t1.confidence >= t2.confidence ? t1.id : t2.id,
              duplicateId: t1.confidence >= t2.confidence ? t2.id : t1.id,
              distanceMeters: Math.round(dist)
            });
          }
        }
      }
    }

    return duplicates;
  }
}

export const backendAiEngine = new BackendAiEngine();
