import { describe, expect, it, beforeEach } from "vitest";
import { TrackManager } from "../server/core/trackManager.js";
import { ImpactManager } from "../server/core/impactManager.js";
import type { Observation } from "../server/domain/types.js";

describe("Replay Engine & Edge-Case Robustness", () => {
  let manager: TrackManager;
  let impactMgr: ImpactManager;

  beforeEach(() => {
    manager = new TrackManager();
    impactMgr = new ImpactManager();
  });

  it("handles out-of-order and delayed packets without position jumping", () => {
    const t0 = Date.now() - 15_000;

    // Normal sequence
    const obs1: Observation = {
      id: "uav-replay-01",
      type: "uav",
      lat: 50.0,
      lon: 30.0,
      heading: 90,
      speed: 50,
      timestamp: t0,
      source: "sdr",
      confidence: 0.9
    };
    manager.ingest(obs1, t0);

    const obs2: Observation = {
      id: "uav-replay-01",
      type: "uav",
      lat: 50.0,
      lon: 30.007,
      heading: 90,
      speed: 50,
      timestamp: t0 + 10_000,
      source: "sdr",
      confidence: 0.9
    };
    manager.ingest(obs2, t0 + 10_000);

    // Delayed old packet arrives 35s late (older than 25s threshold)
    const lateObs: Observation = {
      id: "uav-replay-01",
      type: "uav",
      lat: 49.99,
      lon: 29.98,
      heading: 90,
      speed: 50,
      timestamp: t0 - 28_000,
      source: "sdr",
      confidence: 0.9
    };
    manager.ingest(lateObs, t0 + 10_000);

    const snapshot = manager.snapshot();
    expect(snapshot.length).toBe(1);
    const track = snapshot[0];
    // Position must remain at the latest point (lon >= 30.0), not dragged back
    expect(track.lon).toBeGreaterThanOrEqual(30.0);
  });

  it("prevents false track merge when two targets cross flight paths", () => {
    const t0 = Date.now() - 10_000;

    // Target A: flying North at 45 m/s (Shahed-136)
    const targetA1: Observation = {
      id: "target-north",
      type: "uav",
      lat: 49.98,
      lon: 30.0,
      heading: 0,
      speed: 45,
      timestamp: t0,
      source: "sdr",
      confidence: 0.92
    };
    // Target B: flying East at 140 m/s (Shahed-238 Jet)
    const targetB1: Observation = {
      id: "target-east",
      type: "uav",
      lat: 50.0,
      lon: 29.98,
      heading: 90,
      speed: 140,
      timestamp: t0,
      source: "sdr",
      confidence: 0.92
    };

    manager.ingest(targetA1, t0);
    manager.ingest(targetB1, t0);

    expect(manager.snapshot().length).toBe(2);

    // After 2 seconds, they both approach (50.0, 30.0)
    const targetA2: Observation = {
      id: "target-north",
      type: "uav",
      lat: 50.0,
      lon: 30.0,
      heading: 0,
      speed: 45,
      timestamp: t0 + 2000,
      source: "sdr",
      confidence: 0.92
    };
    const targetB2: Observation = {
      id: "target-east",
      type: "uav",
      lat: 50.0,
      lon: 30.0,
      heading: 90,
      speed: 140,
      timestamp: t0 + 2000,
      source: "sdr",
      confidence: 0.92
    };

    manager.ingest(targetA2, t0 + 2000);
    manager.ingest(targetB2, t0 + 2000);

    // Both distinct tracks must remain independent!
    const active = manager.snapshot();
    expect(active.length).toBe(2);
    const northTrack = active.find((t) => t.id === "target-north");
    const eastTrack = active.find((t) => t.id === "target-east");

    expect(northTrack).toBeDefined();
    expect(eastTrack).toBeDefined();
    expect(northTrack?.model).toBe("Shahed-136");
    expect(eastTrack?.model).toBe("Shahed-238 (Jet)");
  });

  it("verifies Impact TTL = 60 min and Intercept TTL = 10 min", () => {
    const now = Date.now();

    // Create an impact event 30 minutes ago
    impactMgr.recordEvent({
      id: "impact-01",
      type: "impact",
      lat: 50.45,
      lon: 30.52,
      timestamp: now - 30 * 60 * 1000, // 30 min ago
      targetModel: "Х-101",
      targetType: "munition",
      region: "Київ"
    });

    // Create an intercept event 15 minutes ago (exceeds 10m TTL)
    impactMgr.recordEvent({
      id: "intercept-01",
      type: "intercept",
      lat: 50.42,
      lon: 30.48,
      timestamp: now - 15 * 60 * 1000, // 15 min ago
      targetModel: "Shahed-136",
      targetType: "uav",
      region: "Київська обл."
    });

    // Create an intercept event 5 minutes ago (within 10m TTL)
    impactMgr.recordEvent({
      id: "intercept-02",
      type: "intercept",
      lat: 49.99,
      lon: 36.23,
      timestamp: now - 5 * 60 * 1000, // 5 min ago
      targetModel: "Shahed-136",
      targetType: "uav",
      region: "Харків"
    });

    const activeEvents = impactMgr.getRecentEvents(now);

    // Impact (30 min ago) must still be active because TTL is 60 min
    const impact = activeEvents.find((e) => e.id === "impact-01");
    expect(impact).toBeDefined();

    // Intercept 01 (15 min ago) must be expired because TTL is 10 min
    const interceptExpired = activeEvents.find((e) => e.id === "intercept-01");
    expect(interceptExpired).toBeUndefined();

    // Intercept 02 (5 min ago) must be active
    const interceptActive = activeEvents.find((e) => e.id === "intercept-02");
    expect(interceptActive).toBeDefined();
  });
});
