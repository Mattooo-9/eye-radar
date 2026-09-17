import { describe, expect, it } from "vitest";
import { TrackManager } from "../server/core/trackManager.js";
import { GroundSensorSource } from "../server/sources/groundSensor.js";
import { toObservation } from "../server/domain/unifiedObservation.js";
import type { Observation } from "../server/domain/types.js";

describe("Multi-Sensor Indirect Corroboration & Uncertainty Gating", () => {
  it("maintains wide spatial uncertainty, tentative lifecycle, and UNKNOWN model for isolated acoustic detection", async () => {
    const tm = new TrackManager();
    const groundSource = new GroundSensorSource();

    const now = Date.now();
    // Ingest single acoustic detection
    groundSource.ingestDirectPacket({
      version: "1.0",
      timestamp: now,
      networkId: "net-acoustic-north",
      detections: [
        {
          detectionId: "ac-det-101",
          sensorId: "mic-array-04",
          sensorType: "acoustic",
          timestamp: now,
          lat: 50.45,
          lon: 30.52,
          targetType: "uav",
          confidence: 0.38,
          soundLevelDb: 82
        }
      ]
    });

    const unifiedObs = await groundSource.fetchTracks();
    expect(unifiedObs.length).toBe(1);
    const obs = toObservation(unifiedObs[0]);

    const track = tm.ingest(obs, now);
    expect(track).toBeDefined();
    if (!track) return;

    // 1. Must NOT fabricate confirmed combat type or model (no Shahed-136 without corroboration)
    expect(track.type).toBe("unknown");
    expect(track.model).toContain("Непідтверджена повітряна ціль");

    // 2. Must preserve realistic wide uncertainty radius (12,000m)
    expect(track.uncertaintyRadius).toBeGreaterThanOrEqual(10_000);

    // 3. Must be tentative and have conservative confidence
    expect(track.lifecycle).toBe("TENTATIVE");
    expect(track.confidence).toBeLessThanOrEqual(0.50);
    expect(track.provenanceChain).toBeDefined();
    expect(track.provenanceChain?.[0].source).toContain("acoustic");
  });

  it("corroborates across independent sensor modalities (acoustic + radar), reducing uncertainty and promoting to CONFIRMED", async () => {
    const tm = new TrackManager();
    const now = Date.now();

    // 1. First: acoustic detection with wide uncertainty
    const acousticObs: Observation = {
      id: "sensor-target-1",
      type: "unknown",
      lat: 50.450,
      lon: 30.520,
      timestamp: now - 3000,
      confidence: 0.40,
      uncertaintyRadius: 12_000,
      source: "ground.sensor",
      meta: {
        source_id: "ground.acoustic",
        source_family: "acoustic",
        measurement_accuracy: 12_000,
        evidence: ["acoustic_buzz_frequency"]
      }
    };

    const t1 = tm.ingest(acousticObs, now - 3000);
    expect(t1?.type).toBe("unknown");
    expect(t1?.lifecycle).toBe("TENTATIVE");
    expect(t1?.uncertaintyRadius).toBeGreaterThanOrEqual(10_000);

    // 2. Second: independent ground radar detection within the spatial uncertainty area (3km away, 2s later)
    const radarObs: Observation = {
      id: "radar-obs-99",
      type: "uav",
      lat: 50.465,
      lon: 30.540,
      speed: 52,
      heading: 260,
      timestamp: now - 1000,
      confidence: 0.88,
      uncertaintyRadius: 150,
      source: "ground.radar",
      meta: {
        source_id: "ground.radar",
        source_family: "radar",
        measurement_accuracy: 150,
        evidence: ["radar_doppler_echo"]
      }
    };

    const t2 = tm.ingest(radarObs, now - 1000);
    expect(t2).toBeDefined();
    if (!t2) return;

    // Must correlate to same track
    expect(t2.id).toBe(t1?.id);

    // Fused uncertainty shrinks dramatically via covariance intersection
    expect(t2.uncertaintyRadius).toBeLessThan(1000);

    // Confidence boosted due to independent sensor diversity bonus
    expect(t2.confidence).toBeGreaterThan(0.70);

    // Promoted to confirmed with provenance recording both sensors
    expect(t2.lifecycle).toBe("CONFIRMED");
    expect(t2.provenanceChain?.length).toBe(2);
    expect(t2.evidenceFamilies).toContain("acoustic");
    expect(t2.evidenceFamilies).toContain("radar");
  });
});
