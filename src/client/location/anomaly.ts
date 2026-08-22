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
}

export const detectLocationAnomaly = (
  previous: RawLocationSample | null,
  current: RawLocationSample,
  coarseIpLocation?: { lat: number; lon: number } | null
): AnomalyResult => {
  const flags: string[] = [];
  let trustScore = 100;

  if (current.accuracy <= 0 || current.accuracy > 10_000) {
    flags.push("accuracy_outlier");
    trustScore -= 25;
  }

  if (previous) {
    const distance = haversineMeters(previous, current);
    const deltaSeconds = Math.max((current.timestamp - previous.timestamp) / 1000, 1);
    const derivedSpeed = distance / deltaSeconds;

    if (current.timestamp <= previous.timestamp) {
      flags.push("non_monotonic_time");
      trustScore -= 15;
    }

    if (current.accuracy > previous.accuracy * 12 && current.accuracy - previous.accuracy > 250) {
      flags.push("accuracy_jump");
      trustScore -= 20;
    }

    if (derivedSpeed > 420 && (current.speed ?? 0) < 3) {
      flags.push("zero_speed_mismatch");
      trustScore -= 30;
    }

    if (derivedSpeed > 1_000) {
      flags.push("teleport");
      trustScore -= 40;
    }
  }

  if (coarseIpLocation) {
    const ipDistance = haversineMeters(current, coarseIpLocation);
    if (ipDistance > 80_000) {
      flags.push("ip_mismatch");
      trustScore -= 15;
    }
  }

  return {
    trustScore: Math.max(0, Math.min(100, trustScore)),
    flags
  };
};
