import { describe, expect, it } from "vitest";
import { TrackManager } from "../server/core/trackManager.js";
import { sourceRegistry } from "../server/sources/SourceRegistry.js";
import { SourceHealthTracker } from "../server/sources/sourceHealth.js";
import { timeCalibrationService } from "../server/core/timeCalibration.js";
import type { Observation } from "../server/domain/types.js";

describe("Deterministic Fusion, EW (РЭБ) Resiliency & Classification Guardrails", () => {
  it("rejects impossible physical jumps (> 1100 m/s or > 40 km in < 30s) and marks degraded with ewFlags", () => {
    const manager = new TrackManager();
    const t0 = 1700000000000;

    // Initial valid observation: Shahed-136 near Kyiv
    const obs1: Observation = {
      id: "track-ew-01",
      type: "uav",
      lat: 50.45,
      lon: 30.52,
      heading: 90,
      speed: 52,
      altitude: 250,
      timestamp: t0,
      source: "sdr",
      confidence: 0.90,
      meta: {
        source_id: "sdr.receiver",
        received_at: t0 + 20
      }
    };

    const track1 = manager.ingest(obs1, t0 + 20);
    expect(track1).toBeDefined();
    expect(track1?.lat).toBe(50.45);
    expect(track1?.lon).toBe(30.52);

    // 10 seconds later: simulated EW spoofing jump to coordinates 400km away
    // Speed would calculate to 40,000 m/s >> 1100 m/s
    const obsSpoofed: Observation = {
      id: "track-ew-01",
      type: "uav",
      lat: 53.80, // ~370 km North
      lon: 31.00,
      heading: 90,
      speed: 52,
      altitude: 250,
      timestamp: t0 + 10000,
      source: "sdr",
      confidence: 0.90,
      meta: {
        source_id: "sdr.receiver",
        received_at: t0 + 10020
      }
    };

    const track2 = manager.ingest(obsSpoofed, t0 + 10020);
    expect(track2).toBeDefined();

    // Verification:
    // 1. Position is clamped to previous valid coordinates (50.45, 30.52), NOT the spoofed 53.80
    expect(track2?.lat).toBe(50.45);
    expect(track2?.lon).toBe(30.52);

    // 2. Confidence is clamped <= 0.25
    expect(track2?.confidence).toBeLessThanOrEqual(0.25);

    // 3. Marked as degraded with EW flags
    expect(track2?.isDegraded).toBe(true);
    expect(track2?.ewFlags).toContain("impossible_jump_rejected");
    expect(track2?.model).toContain("аномальний стрибок РЕБ");
  });

  it("strictly prohibits assigning combat types (SHAHED/MISSILE/KAB) from pure ADS-B/MLAT kinematics", () => {
    const manager = new TrackManager(sourceRegistry);
    const t0 = 1700000000000;

    // Commercial or open ADS-B flight traveling at Shahed-like speed (52 m/s, low altitude)
    const adsbObs: Observation = {
      id: "commercial-adsb-01",
      type: "aircraft",
      lat: 48.0,
      lon: 31.0,
      heading: 90,
      speed: 52, // 187 km/h - typical Shahed speed
      altitude: 300,
      timestamp: t0,
      source: "adsb",
      confidence: 0.85,
      meta: {
        source_id: "airplanes.live",
        received_at: t0 + 50
      }
    };

    const track = manager.ingest(adsbObs, t0 + 50);
    expect(track).toBeDefined();

    // Pure ADS-B kinematics must NEVER convert to 'uav' or combat threat
    // Must remain civilian/generic aircraft or unknown
    expect(track?.type).not.toBe("uav");
    expect(track?.type).not.toBe("munition");
    expect(track?.threatLevel).not.toBe("critical");
  });

  it("downgrades source to DEGRADED when timing calibration exhibits excessive jitter or drift", () => {
    const tracker = new SourceHealthTracker();
    timeCalibrationService.reset();
    const sourceId = "sdr.receiver";

    const now = 1700000000000;
    // Feed samples with high clock offset and high jitter (> 1500ms jitter)
    timeCalibrationService.recordAndCalibrate(sourceId, now - 6000, now, now - 5000);
    timeCalibrationService.recordAndCalibrate(sourceId, now - 1000, now + 1000, now - 500);
    timeCalibrationService.recordAndCalibrate(sourceId, now - 9000, now + 2000, now - 8000);

    // Verify timeCalibration flags degraded timing
    expect(timeCalibrationService.isTimingDegraded(sourceId)).toBe(true);

    // Register success in health tracker
    tracker.recordSuccess(sourceId, 50, 5);

    // Health tracker should report DEGRADED due to timing jitter
    const state = tracker.getSourceState(sourceId);
    expect(state).toBe("DEGRADED");
  });
});
