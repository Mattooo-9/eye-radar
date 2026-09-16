import { describe, it, expect, beforeEach } from "vitest";
import { classifyAerialObject } from "../server/core/classificationEngine.js";
import { TrackManager } from "../server/core/trackManager.js";
import { Observation } from "../server/domain/types.js";

describe("Eye Aerial Target Classification Policy & Combat Evidence Gating", () => {
  let manager: TrackManager;

  beforeEach(() => {
    manager = new TrackManager();
  });

  describe("1. Pure ADS-B / MLAT / OpenSky Kinematics Restrictions", () => {
    it("strictly classifies ADS-B at 185 km/h (51.4 m/s) as UNKNOWN, NEVER Shahed", () => {
      // 185 km/h is classic Shahed cruising speed, but pure ADS-B must never classify it as a combat target
      const result = classifyAerialObject({
        claimedType: "unknown",
        speedMs: 185 / 3.6, // 51.38 m/s
        altitudeM: 250,
        headingDeg: 190,
        sources: ["adsb"],
        positionConfidence: 0.95
      });

      expect(result.resolvedType).toBe("unknown");
      expect(result.resolvedModel).toContain("Невідома");
      expect(result.resolvedModel).not.toContain("Shahed");
      expect(result.resolvedType).not.toBe("uav");
      expect(result.classConfidence).toBeLessThanOrEqual(0.40);
      expect(result.positionConfidence).toBe(0.95);
      expect(result.classEvidence).toContain("adsb_mlat_kinematics_only");
      expect(result.classEvidence).toContain("unconfirmed_threat_evidence_absent");
    });

    it("strictly classifies ADS-B at 820 km/h (227.7 m/s) as UNKNOWN or AIRCRAFT, NEVER cruise missile", () => {
      // 820 km/h is cruise missile speed, but pure ADS-B must never classify it as cruise missile (munition)
      const result = classifyAerialObject({
        claimedType: "unknown",
        speedMs: 820 / 3.6, // 227.7 m/s
        altitudeM: 1200,
        headingDeg: 270,
        sources: ["adsb"],
        positionConfidence: 0.98
      });

      expect(result.resolvedType).not.toBe("munition");
      expect(result.resolvedType).not.toBe("bomb");
      expect(result.resolvedType).toBe("unknown");
      expect(result.resolvedModel).not.toContain("Калібр");
      expect(result.resolvedModel).not.toContain("Х-101");
      expect(result.alternative?.type).toBe("aircraft");
      expect(result.alternative?.model).toContain("Літак");
      expect(result.positionConfidence).toBe(0.98);
      expect(result.classConfidence).toBeLessThanOrEqual(0.40);
    });

    it("correctly identifies civil aircraft from reliable transponder metadata", () => {
      const result = classifyAerialObject({
        claimedType: "unknown",
        modelHint: "Boeing 737-800",
        callsign: "WZZ123",
        speedMs: 230,
        altitudeM: 10000,
        headingDeg: 90,
        sources: ["airplanes.live"],
        positionConfidence: 0.99
      });

      expect(result.resolvedType).toBe("aircraft");
      expect(result.resolvedModel).toBe("Boeing 737-800");
      expect(result.classConfidence).toBeGreaterThanOrEqual(0.90);
      expect(result.classEvidence).toContain("transponder_metadata");
    });

    it("correctly identifies helicopter from transponder metadata or rotary wing profile", () => {
      const result = classifyAerialObject({
        claimedType: "unknown",
        modelHint: "Mil Mi-8AMT",
        speedMs: 55,
        altitudeM: 300,
        headingDeg: 120,
        sources: ["opensky.live"],
        positionConfidence: 0.90
      });

      expect(result.resolvedType).toBe("helicopter");
      expect(result.resolvedModel).toBe("Mil Mi-8AMT");
      expect(result.classConfidence).toBeGreaterThanOrEqual(0.90);
      expect(result.classEvidence).toContain("transponder_metadata");
    });
  });

  describe("2. Sensor Threat Evidence Gating for Combat Targets", () => {
    it("unlocks Shahed-136 classification when confirmed acoustic or optical evidence is present", () => {
      const result = classifyAerialObject({
        claimedType: "uav",
        speedMs: 52, // ~187 km/h
        altitudeM: 200,
        headingDeg: 180,
        sources: ["sdr.receiver"],
        threatEvidence: ["acoustic_moped_engine", "optical_delta_wing"],
        positionConfidence: 0.91
      });

      expect(result.resolvedType).toBe("uav");
      expect(result.resolvedModel).toBe("Shahed-136");
      expect(result.classConfidence).toBeGreaterThanOrEqual(0.90);
      expect(result.threatEvidence).toContain("acoustic_moped_engine");
      expect(result.threatEvidence).toContain("optical_delta_wing");
      expect(result.positionConfidence).toBe(0.91);
    });

    it("unlocks Cruise Missile (Х-101 / Калібр) when confirmed radar tracking evidence is present", () => {
      const result = classifyAerialObject({
        claimedType: "munition",
        speedMs: 235, // ~846 km/h
        altitudeM: 150,
        headingDeg: 280,
        sources: ["ground.sensor"],
        threatEvidence: ["radar_tracking_low_rcs_transonic"],
        positionConfidence: 0.94
      });

      expect(result.resolvedType).toBe("munition");
      expect(result.resolvedModel).toContain("Х-101 / Калібр");
      expect(result.classConfidence).toBeGreaterThanOrEqual(0.90);
      expect(result.threatEvidence).toContain("radar_tracking_low_rcs_transonic");
    });

    it("unlocks KAB-500 guided bomb when ballistic / glide evidence is present", () => {
      const result = classifyAerialObject({
        claimedType: "bomb",
        speedMs: 290,
        altitudeM: 3500,
        headingDeg: 220,
        sources: ["ground.sensor"],
        threatEvidence: ["radar_glide_trajectory_umpk"],
        positionConfidence: 0.88
      });

      expect(result.resolvedType).toBe("bomb");
      expect(result.resolvedModel).toContain("КАБ-500 з УМПК");
      expect(result.classConfidence).toBeGreaterThanOrEqual(0.90);
    });
  });

  describe("3. Regional Alert Sanity Check and Positional Integrity", () => {
    it("demotes combat target to UNKNOWN when no alert is active in the region, while keeping position and IMM intact", () => {
      // Ingest a potential combat target in Poltava region (lat: 49.58, lon: 34.55) without any active alert
      const now = Date.now();
      const obs1: Observation = {
        id: "combat-candidate-01",
        type: "uav",
        lat: 49.588,
        lon: 34.551,
        speed: 50,
        heading: 180,
        altitude: 200,
        source: "sdr",
        meta: { source_id: "sdr.receiver" },
        confidence: 0.93,
        timestamp: now
      };

      manager.ingest(obs1, now);
      const track1 = manager.getTrack("combat-candidate-01");

      expect(track1).toBeDefined();
      // Sanity check MUST have fired because Poltava oblast has no active alert and no threatEvidence was provided
      expect(track1?.type).toBe("unknown");
      expect(track1?.model).toContain("Невідома повітряна ціль (тривога відсутня)");
      expect(track1?.classConfidence).toBeLessThanOrEqual(0.25);
      expect(track1?.classEvidence).toContain("sanity_check_no_alert_demoted_to_unknown");

      // Positional track, coordinates, speed, heading, and IMM must remain completely preserved and accurate!
      expect(track1?.lat).toBeCloseTo(49.588, 3);
      expect(track1?.lon).toBeCloseTo(34.551, 3);
      expect(track1?.speed).toBe(50);
      expect(track1?.heading).toBe(180);
      expect(track1?.positionConfidence).toBe(0.93);
    });

    it("preserves combat classification when active alert is declared for the region", () => {
      // Set active alert for Poltava oblast
      manager.setActiveAlertOblasts(["Полтавська область", "м. Полтава"]);

      const now = Date.now();
      const obs: Observation = {
        id: "shahed-alerted-01",
        type: "uav",
        lat: 49.59,
        lon: 34.56,
        speed: 51,
        heading: 190,
        altitude: 250,
        source: "sdr",
        meta: { source_id: "sdr.receiver" },
        confidence: 0.94,
        timestamp: now
      };

      manager.ingest(obs, now);
      const track = manager.getTrack("shahed-alerted-01");

      expect(track).toBeDefined();
      // Alert is active, so combat type is allowed
      expect(track?.type).toBe("uav");
      expect(track?.model).toBe("Shahed-136");
      expect(track?.classConfidence).toBeGreaterThanOrEqual(0.85);
    });

    it("preserves combat classification even without regional alert IF independent threatEvidence is verified", () => {
      // No active alerts
      manager.setActiveAlertOblasts([]);

      const now = Date.now();
      const obs: Observation = {
        id: "shahed-with-sensor-evidence",
        type: "uav",
        lat: 50.45,
        lon: 30.52,
        speed: 50,
        heading: 180,
        altitude: 220,
        source: "radar",
        meta: { source_id: "ground.sensor" },
        threatEvidence: ["acoustic_moped_engine"],
        confidence: 0.95,
        timestamp: now
      };

      manager.ingest(obs, now);
      const track = manager.getTrack("shahed-with-sensor-evidence");

      expect(track).toBeDefined();
      // Independent sensor evidence overrides regional alert absence
      expect(track?.type).toBe("uav");
      expect(track?.model).toBe("Shahed-136");
      expect(track?.threatEvidence).toContain("acoustic_moped_engine");
      expect(track?.classConfidence).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe("4. Field Separation: positionConfidence vs classConfidence vs classEvidence", () => {
    it("ensures every track exposes separate positionConfidence, classConfidence, classEvidence and threatEvidence", () => {
      const now = Date.now();
      manager.setActiveAlertOblasts(["Київська область"]);

      manager.ingest(
        {
          id: "field-separation-test",
          type: "uav",
          lat: 50.45,
          lon: 30.52,
          speed: 48,
          heading: 175,
          source: "sdr",
          meta: { source_id: "sdr.receiver" },
          confidence: 0.89,
          threatEvidence: ["acoustic_moped_engine"],
          timestamp: now
        },
        now
      );

      const track = manager.getTrack("field-separation-test");
      expect(track).toBeDefined();

      expect(typeof track?.positionConfidence).toBe("number");
      expect(typeof track?.classConfidence).toBe("number");
      expect(Array.isArray(track?.classEvidence)).toBe(true);
      expect(Array.isArray(track?.threatEvidence)).toBe(true);

      // Verify that positionConfidence reflects measurement accuracy
      expect(track?.positionConfidence).toBeCloseTo(0.89, 2);
      // Verify that classConfidence reflects threat/sensor verification
      expect(track?.classConfidence).toBeGreaterThanOrEqual(0.85);
      // Verify classEvidence contains reasoning tokens
      expect(track?.classEvidence?.length).toBeGreaterThan(0);
    });
  });
});
