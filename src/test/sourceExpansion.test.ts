import { describe, expect, it } from "vitest";
import { SourceRegistry } from "../server/sources/SourceRegistry.js";
import { SourceHealthTracker } from "../server/sources/sourceHealth.js";
import { validateOpenSkyPacket, OpenSkyLiveSource } from "../server/sources/openskyLive.js";
import { validateSdrPacket, SdrReceiverSource } from "../server/sources/sdrReceiver.js";
import { validateGroundSensorPacket, GroundSensorSource } from "../server/sources/groundSensor.js";
import { validateSatellitePacket, SatelliteCoordinateSource } from "../server/sources/satelliteCoordinateSource.js";

describe("Real Positional Source Expansion & Empirical Packet Validation", () => {
  it("validates OpenSky Network packet structure", () => {
    // Valid packet
    const validPayload = {
      time: 1700000000,
      states: [
        [
          "4b1812", // icao24
          "SVR123",  // callsign
          "Switzerland",
          1700000000,
          1700000000,
          30.5,     // lon
          50.4,     // lat
          3000,     // alt
          false,    // on_ground
          180,      // velocity
          90,       // track
          0,
          [1, 2],
          3050,
          "7000",
          false,
          0
        ]
      ]
    };
    expect(validateOpenSkyPacket(validPayload)).toBe(true);

    // Invalid payload
    expect(validateOpenSkyPacket(null)).toBe(false);
    expect(validateOpenSkyPacket({})).toBe(false);
    expect(validateOpenSkyPacket({ time: 0, states: [] })).toBe(false);
  });

  it("validates SDR readsb/dump1090 packet structure", () => {
    const validSdr = {
      now: 1700000000.5,
      messages: 1420,
      aircraft: [
        {
          hex: "4b89a1",
          flight: "UKR001",
          lat: 49.5,
          lon: 31.2,
          speed: 150,
          track: 120,
          seen: 0.5,
          rssi: -16.5
        }
      ]
    };
    expect(validateSdrPacket(validSdr)).toBe(true);

    expect(validateSdrPacket(null)).toBe(false);
    expect(validateSdrPacket({ now: -1 })).toBe(false);
  });

  it("validates tactical Ground Radar and Acoustic sensor packets", () => {
    const validGround = {
      version: "1.0",
      timestamp: Date.now(),
      networkId: "zvook-acoustic-net",
      detections: [
        {
          detectionId: "det-zvook-01",
          sensorId: "zvook-kyiv-north",
          sensorType: "acoustic" as const,
          timestamp: Date.now(),
          lat: 50.55,
          lon: 30.45,
          speedMs: 48,
          headingDeg: 175,
          targetType: "uav" as const,
          confidence: 0.94,
          soundLevelDb: 78
        }
      ]
    };
    expect(validateGroundSensorPacket(validGround)).toBe(true);

    // Invalid coordinates
    const invalidCoords = {
      ...validGround,
      detections: [{ ...validGround.detections[0], lat: 199.9 }]
    };
    expect(validateGroundSensorPacket(invalidCoords)).toBe(false);
  });

  it("validates Satellite Earth Observation direct coordinate feed", () => {
    const validSat = {
      passId: "sentinel-1-pass-2026",
      timestamp: Date.now(),
      satellite: "Sentinel-1A (C-SAR)",
      detections: [
        {
          recordId: "sar-det-99",
          constellation: "Copernicus",
          sensorType: "SAR" as const,
          timestamp: Date.now(),
          lat: 46.5,
          lon: 31.8,
          confidence: 0.92,
          detectionType: "aircraft" as const
        }
      ]
    };
    expect(validateSatellitePacket(validSat)).toBe(true);
    expect(validateSatellitePacket({ timestamp: Date.now(), satellite: "" })).toBe(false);
  });

  it("activates sources in SourceRegistry only upon empirical validation", () => {
    const registry = new SourceRegistry();
    const health = new SourceHealthTracker();
    registry.setHealthTracker(health);

    const sdr = new SdrReceiverSource();
    registry.register("sdr.receiver", "sdr_local", sdr, {
      primaryCapability: "TRACK_POSITION",
      capabilities: ["TRACK_POSITION"],
      canCreateTrack: true,
      canClassify: false,
      canProvidePosition: true,
      canProvideAltitude: true,
      canProvideSpeed: true,
      evidenceFamily: "sdr_local",
      evidenceTypes: ["sdr", "adsb"]
    }, { disabled: true });

    // Initially disabled / offline
    expect(registry.getLivePositionalSources().map(s => s.name)).not.toContain("sdr.receiver");

    // Attempt activation with invalid packet -> rejected!
    const failedActivation = registry.validateAndActivate("sdr.receiver", { bad: "data" });
    expect(failedActivation).toBe(false);
    expect(registry.getLivePositionalSources().map(s => s.name)).not.toContain("sdr.receiver");

    // Empirical activation with genuine packet -> accepted into LIVE!
    const successActivation = registry.validateAndActivate("sdr.receiver", {
      now: 1700000000,
      aircraft: [{ hex: "4b89a1", lat: 49.5, lon: 31.2, speed: 150 }]
    });
    expect(successActivation).toBe(true);
    expect(registry.getLivePositionalSources().map(s => s.name)).toContain("sdr.receiver");
  });
});
