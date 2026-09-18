import { describe, expect, it, beforeEach } from "vitest";
import { TrackManager } from "../server/core/trackManager.js";
import { UncertaintyEventManager } from "../server/core/uncertaintyEventManager.js";
import { productionObservability } from "../server/core/observability.js";
import type { Observation } from "../server/domain/types.js";

describe("3-Layer Architecture and Uncertainty Layer", () => {
  let manager: TrackManager;
  let uncertaintyMgr: UncertaintyEventManager;

  beforeEach(() => {
    manager = new TrackManager();
    uncertaintyMgr = new UncertaintyEventManager();
  });

  it("routes non-positional observations to UncertaintyEventManager instead of rejecting them", () => {
    const now = Date.now();
    const acousticObs: Observation = {
      id: "ground-sensor-acoustic-01",
      type: "unknown",
      lat: 50.45,
      lon: 30.52,
      timestamp: now,
      source: "ground.sensor",
      confidence: 0.75,
      uncertaintyRadius: 12000,
      threatEvidence: ["acoustic_engine_sound"],
      meta: {
        source_family: "acoustic",
        sensor_type: "acoustic_array"
      }
    };

    uncertaintyMgr.ingestObservation(acousticObs, now);
    const events = uncertaintyMgr.getActiveEvents(now);
    expect(events.length).toBe(1);
    expect(events[0].sourceFamily).toBe("acoustic");
    expect(events[0].uncertaintyRadius).toBe(12000);
    expect(events[0].lat).toBe(50.45);
    expect(events[0].lon).toBe(30.52);
    expect(events[0].details).toBeDefined();
  });

  it("prunes expired uncertainty events according to their source family TTL", () => {
    const now = Date.now();
    uncertaintyMgr.ingest({
      id: "ev-acoustic-old",
      lat: 49.0,
      lon: 31.0,
      uncertaintyRadius: 10000,
      sourceFamily: "acoustic",
      source: "ground_sensors",
      confidence: 0.7,
      timestamp: now - 350_000,
      label: "Acoustic detection",
      ttlMs: 100_000
    }, now - 350_000);
    uncertaintyMgr.ingest({
      id: "ev-thermal-active",
      lat: 48.5,
      lon: 32.0,
      uncertaintyRadius: 2500,
      sourceFamily: "thermal",
      source: "firms",
      confidence: 0.85,
      timestamp: now - 600_000,
      label: "Thermal hotspot",
      ttlMs: 1_800_000
    }, now - 600_000);
    uncertaintyMgr.pruneExpired(now);
    const active = uncertaintyMgr.getActiveEvents(now);
    expect(active.length).toBe(1);
    expect(active[0].id).toBe("ev-thermal-active");
  });

  it("does NOT demote civilian aircraft or border flights to unknown/threat when regional alert is absent", () => {
    const now = Date.now();
    const civilFlight: Observation = {
      id: "RYR-1234",
      type: "aircraft",
      lat: 51.5,
      lon: 23.5,
      heading: 180,
      speed: 220,
      altitude: 10500,
      timestamp: now,
      source: "adsb.lol",
      confidence: 0.95,
      meta: {
        callsign: "RYR1234",
        model: "Boeing 737-800",
        source_id: "adsb_lol"
      }
    };
    const track = manager.ingest(civilFlight, now);
    expect(track).toBeDefined();
    expect(track?.type).toBe("aircraft");
    expect(track?.threatLevel).toBeUndefined();
    expect(track?.model).not.toContain("Невідома");
  });

  it("records fusedObservations in pipeline observability metrics", () => {
    const now = Date.now();
    const beforeFused = productionObservability.getPipelineDiagnostics().fusedObservations;
    const testTarget: Observation = {
      id: "target-fused-test",
      type: "uav",
      lat: 50.0,
      lon: 30.0,
      heading: 90,
      speed: 45,
      timestamp: now,
      source: "sdr",
      confidence: 0.9,
      meta: { isSynthetic: true }
    };
    manager.ingest(testTarget, now);
    const metrics = productionObservability.getPipelineDiagnostics();
    expect(metrics.fusedObservations).toBeGreaterThanOrEqual(beforeFused + 1);
  });
});
