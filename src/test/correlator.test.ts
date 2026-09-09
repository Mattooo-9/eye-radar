import { describe, expect, it } from "vitest";
import { TrackCorrelator } from "../server/core/trackCorrelator.js";
import type { Observation, TrackState } from "../server/domain/types.js";

describe("TrackCorrelator", () => {
  const correlator = new TrackCorrelator(30_000);

  it("associates nearby observation with matching heading to existing track", () => {
    const existingTrack: TrackState = {
      id: "trk-01",
      type: "uav",
      lat: 49.58,
      lon: 34.55,
      heading: 220,
      speed: 50,
      timestamp: 10_000,
      confidence: 0.7,
      sources: new Set(["osint"])
    };

    const newObs: Observation = {
      id: "obs-random-99",
      type: "uav",
      lat: 49.56, // ~3 km away
      lon: 34.52,
      heading: 215, // matching heading
      timestamp: 10_060,
      source: "sdr",
      confidence: 0.8
    };

    const match = correlator.findBestMatch(newObs, [existingTrack]);
    expect(match.matchedTrackId).toBe("trk-01");
    expect(match.confidenceBonus).toBe(0.2); // independent source bonus
  });

  it("rejects association when target is too distant or heading opposes", () => {
    const existingTrack: TrackState = {
      id: "trk-01",
      type: "uav",
      lat: 49.58,
      lon: 34.55,
      heading: 0, // heading north
      speed: 50,
      timestamp: 10_000,
      confidence: 0.7,
      sources: new Set(["osint"])
    };

    const distantObs: Observation = {
      id: "obs-far",
      type: "uav",
      lat: 51.58, // > 200 km away
      lon: 34.55,
      timestamp: 10_010,
      source: "sdr",
      confidence: 0.7
    };

    const match = correlator.findBestMatch(distantObs, [existingTrack]);
    expect(match.matchedTrackId).toBeNull();
  });
});
