import { describe, expect, it } from "vitest";
import { ThreatEngine } from "../server/core/threatEngine.js";
import type { TrackState, UserLocation } from "../server/domain/types.js";

describe("ThreatEngine", () => {
  const engine = new ThreatEngine();

  const kyivUser: UserLocation = {
    lat: 50.4501,
    lon: 30.5234,
    accuracy: 10,
    timestamp: Date.now()
  };

  it("classifies approaching UAV within 20km as critical threat with ETA", () => {
    // Shahed south of Kyiv (lat 50.28, lon 30.52), heading 0 (north directly towards Kyiv)
    const incomingDrone: TrackState = {
      id: "uav-direct",
      type: "uav",
      lat: 50.28,
      lon: 30.52,
      heading: 0,
      speed: 50, // 50 m/s
      timestamp: Date.now(),
      confidence: 0.9,
      sources: new Set(["osint", "sdr"])
    };

    const evaluation = engine.evaluateThreat(incomingDrone, kyivUser);

    expect(evaluation.threatLevel).toBe("critical");
    expect(evaluation.isHeadingTowards).toBe(true);
    expect(evaluation.etaMinutes).toBeGreaterThan(0);
    expect(evaluation.etaMinutes).toBeLessThan(15);
    expect(evaluation.warningMessage).toContain("КРИТИЧНА НЕБЕЗПЕКА");
  });

  it("classifies receding target as low threat", () => {
    // UAV south of Kyiv, but heading south (180 deg, away from Kyiv)
    const movingAwayDrone: TrackState = {
      id: "uav-away",
      type: "uav",
      lat: 50.28,
      lon: 30.52,
      heading: 180, // heading south away
      speed: 50,
      timestamp: Date.now(),
      confidence: 0.8,
      sources: new Set(["osint"])
    };

    const evaluation = engine.evaluateThreat(movingAwayDrone, kyivUser);
    expect(evaluation.isHeadingTowards).toBe(false);
    expect(evaluation.threatLevel).toBe("low");
  });
});
