import { haversineMeters } from "../lib/geo";

export interface RawLocationSample {
  lat: number;
  lon: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export interface AnomalyResult {
  trustScore: number;
  flags: string[];
  isSpoofed: boolean;
  isDegraded: boolean;
}

export const detectLocationAnomaly = (
  previous: RawLocationSample | null,
  current: RawLocationSample,
  confirmedBackup?: { lat: number; lon: number } | null
): AnomalyResult => {
  const flags: string[] = [];
  let trustScore = 100;
  let isSpoofed = false;

  // 1. Accuracy limits
  if (current.accuracy <= 0 || current.accuracy > 5_000) {
    flags.push("accuracy_outlier");
    trustScore -= 30;
  }

  // 2. High EW degradation: accuracy suddenly degraded into 1000m+
  if (current.accuracy > 1_500) {
    flags.push("ew_interference");
    trustScore -= 25;
  }

  // 3. Coordinate plausibility for Ukraine theater bounds (lat 43..53.5, lon 21..41)
  const inUkraineRegion = current.lat >= 43.0 && current.lat <= 53.5 && current.lon >= 21.0 && current.lon <= 41.0;
  if (!inUkraineRegion) {
    flags.push("geofence_violation");
    trustScore -= 50;
    isSpoofed = true;
  }

  if (previous) {
    const distance = haversineMeters(previous, current);
    const deltaSeconds = Math.max((current.timestamp - previous.timestamp) / 1000, 0.5);
    const derivedSpeed = distance / deltaSeconds;

    // Time inversion or non-monotonic sample
    if (current.timestamp <= previous.timestamp) {
      flags.push("non_monotonic_time");
      trustScore -= 20;
    }

    // Abrupt jump in accuracy (typical during spoofing transmitter activation)
    if (current.accuracy > previous.accuracy * 10 && current.accuracy - previous.accuracy > 200) {
      flags.push("accuracy_jump");
      trustScore -= 25;
    }

    // Kinematic mismatch: massive derived displacement (> 380 m/s ~ 1360 km/h) but stationary sensor speed
    if (derivedSpeed > 380 && (current.speed ?? 0) < 5) {
      flags.push("zero_speed_mismatch");
      trustScore -= 45;
      isSpoofed = true;
    }

    // Impossible civilian jump speed (> 750 m/s ~ Mach 2.2)
    if (derivedSpeed > 750) {
      flags.push("teleport");
      trustScore -= 60;
      isSpoofed = true;
    }
  }

  // Check consistency with confirmed backup location if present (> 350 km jump without speed)
  if (confirmedBackup) {
    const backupDist = haversineMeters(current, confirmedBackup);
    if (backupDist > 350_000 && (!previous || (previous && (current.speed ?? 0) < 15))) {
      flags.push("backup_divergence");
      trustScore -= 25;
    }
  }

  const normalizedScore = Math.max(0, Math.min(100, trustScore));
  const isDegraded = normalizedScore < 60 || isSpoofed;

  return {
    trustScore: normalizedScore,
    flags,
    isSpoofed,
    isDegraded
  };
};
