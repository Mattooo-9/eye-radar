import { describe, expect, it } from "vitest";
import { TrackManager } from "../server/core/trackManager.ts";
import { createUnifiedObservation, toObservation } from "../server/domain/unifiedObservation.js";
import type { Observation } from "../server/domain/types.js";

describe("Provenance Chain & Track Diagnostics", () => {
  it("attaches provenance records and stores measured vs estimated telemetry", () => {
    const manager = new TrackManager();
    const now = Date.now();

    const uObs = createUnifiedObservation({
      source_id: "airplanes.live",
      source_family: "adsb",
      object_id: "raw-shahed-01",
      observed_at: now - 1500,
      received_at: now - 500,
      lat: 48.512345,
      lon: 35.123456,
      altitude: 450,
      heading: 285,
      speed: 52.5, // ~189 km/h
      object_type: "uav",
      measurement_accuracy: 180,
      evidence: ["kinematic", "transponder"],
      isSynthetic: false
    });

    const obs = toObservation(uObs);
    const track = manager.ingest(obs, now);

    expect(track).not.toBeNull();
    if (!track) return;

    expect(track.measuredLat).toBe(48.512345);
    expect(track.measuredLon).toBe(35.123456);
    expect(track.measuredSpeed).toBe(52.5);
    expect(track.measuredAltitude).toBe(450);
    expect(track.measuredHeading).toBe(285);
    expect(track.isSynthetic).toBe(false);

    expect(track.provenanceChain).toBeDefined();
    expect(track.provenanceChain?.length).toBe(1);
    expect(track.provenanceChain?.[0].source).toBe("airplanes.live");
  });

  it("retrieves full track diagnostic via getTrackDiagnostic()", () => {
    const manager = new TrackManager();
    const now = Date.now();

    const obs: Observation = {
      id: "diag-target-01",
      type: "aircraft",
      lat: 50.4501,
      lon: 30.5234,
      heading: 190,
      speed: 220,
      altitude: 8500,
      timestamp: now - 2000,
      source: "sdr",
      confidence: 0.9,
      meta: {
        source_id: "adsb.lol",
        received_at: now - 300,
        evidence: "kinematic"
      }
    };

    const track = manager.ingest(obs, now);
    expect(track).not.toBeNull();
    if (!track) return;

    const diag = manager.getTrackDiagnostic(track.id);

    expect(diag).toBeDefined();
    expect(diag?.id).toBe(track.id);
    expect(diag?.classification.type).toBeDefined();
    expect(diag?.kinematics.measured.lat).toBe(50.4501);
    expect(diag?.kinematics.estimated.lat).toBeDefined();
    expect(diag?.kinematics.measured.deltaFromEstimatedMeters).toBeGreaterThanOrEqual(0);
    expect(diag?.provenanceChain.length).toBeGreaterThan(0);
    expect(diag?.filter.cvProbability).toBeDefined();
  });

  it("identifies synthetic tracks and isolates them from real production provenance", () => {
    const manager = new TrackManager();
    const now = Date.now();

    const uObs = createUnifiedObservation({
      source_id: "synthetic_simulation",
      source_family: "simulation",
      object_id: "sim-target-99",
      observed_at: now,
      received_at: now,
      lat: 47.1,
      lon: 32.2,
      heading: 90,
      speed: 60,
      object_type: "uav",
      isSynthetic: true
    });

    const syntheticObs = toObservation(uObs);
    syntheticObs.meta = { ...syntheticObs.meta, syntheticScenario: "sim_drone_swarm" };

    const track = manager.ingest(syntheticObs, now);
    expect(track).not.toBeNull();
    if (!track) return;

    expect(track.isSynthetic).toBe(true);
    expect(track.syntheticScenario).toBe("sim_drone_swarm");

    const diag = manager.getTrackDiagnostic(track.id);
    expect(diag?.isSynthetic).toBe(true);
    expect(diag?.provenanceChain[0].isSynthetic).toBe(true);
  });
});
