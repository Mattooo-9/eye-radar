import { describe, expect, it } from "vitest";
import { ThreatAlertSource } from "../server/sources/threatAlertSource.js";
import { TrackManager } from "../server/core/trackManager.js";
import { SourceRegistry } from "../server/sources/SourceRegistry.js";
import type { Observation } from "../server/domain/types.js";

describe("ThreatAlertSource & Air Threat Generation", () => {
  it("generates realistic threat vectors for Ukrainian alert sectors", async () => {
    const source = new ThreatAlertSource();
    const obsList = await source.fetchThreatObservations();

    // In a live environment or fallback, observations are valid Observations
    expect(Array.isArray(obsList)).toBe(true);

    if (obsList.length > 0) {
      const sample = obsList[0];
      expect(sample.id).toBeDefined();
      expect(sample.lat).toBeGreaterThan(42.0);
      expect(sample.lat).toBeLessThan(55.0);
      expect(sample.lon).toBeGreaterThan(20.0);
      expect(sample.lon).toBeLessThan(42.0);
      expect(sample.speed).toBeGreaterThan(30); // UAV or missile speed
      expect(sample.heading).toBeGreaterThanOrEqual(0);
      expect(sample.heading).toBeLessThanOrEqual(360);
      expect(sample.isSynthetic).toBe(false);
      expect(["uav", "munition"]).toContain(sample.type);
    }
  });

  it("TrackManager successfully ingests threat.alert observations into live track table", () => {
    const registry = new SourceRegistry();
    const source = new ThreatAlertSource();

    registry.register(
      "threat.alert",
      "threat_alert",
      source as any,
      {
        primaryCapability: "TRACK_POSITION",
        capabilities: ["TRACK_POSITION"],
        canCreateTrack: true,
        canClassify: true,
        canProvidePosition: true,
        canProvideAltitude: true,
        canProvideSpeed: true,
        evidenceFamily: "threat_alert",
        evidenceTypes: [
          "official_air_raid_alert",
          "aerial_threat_confirmed",
          "alert",
          "threat_alert",
          "air_defense_radar",
          "transonic_cruise_profile",
          "shahed_acoustic_signature"
        ]
      }
    );

    const tm = new TrackManager(registry);

    const sampleObs: Observation = {
      id: "threat-Kyiv-1",
      type: "uav",
      lat: 50.4501,
      lon: 30.5234,
      heading: 315,
      speed: 51.4,
      altitude: 150,
      timestamp: Date.now(),
      source: "threat.alert",
      confidence: 0.95,
      threatEvidence: ["official_air_raid_alert", "air_defense_radar", "shahed_acoustic_signature"],
      isSynthetic: false,
      meta: {
        source_id: "threat.alert",
        model: "Shahed-136 / Герань-2",
        callsign: "SHD-KYIV-1"
      }
    };

    const ingested = tm.ingest(sampleObs);
    expect(ingested).not.toBeNull();
    expect(ingested?.id).toBe("threat-Kyiv-1");
    expect(ingested?.type).toBe("uav");
    expect(ingested?.isSynthetic).toBe(false);

    // Verify it is published in packets
    const packets = tm.toPackets(false);
    expect(packets.length).toBe(1);
    expect(packets[0][0]).toBe("threat-Kyiv-1");
    expect(packets[0][1]).toBe("uav");
  });
});
