import { describe, expect, it } from "vitest";
import {
  createUnifiedObservation,
  computeRawEvidenceHash,
  evaluateObservationFreshness,
  toObservation,
  type UnifiedObservation
} from "../server/domain/unifiedObservation.js";

describe("UnifiedObservation Contract v2 Validation", () => {
  it("creates valid UnifiedObservation v2 with all mandatory fields and aliases", () => {
    const rawPayload = { icao24: "49abcd", callsign: "TEST12", baro_altitude: 4500 };
    const now = Date.now();
    const hash = computeRawEvidenceHash(rawPayload);

    const obs = createUnifiedObservation({
      sourceId: "sdr.receiver",
      sensorType: "sdr",
      rawEvidenceHash: hash,
      observedAt: now - 300,
      receivedAt: now,
      ageMs: 300,
      latency: 45,
      clockOffset: 120,
      jitter: 15,
      uncertaintyRadius: 35,
      resolution: 15,
      positionConfidence: 0.95,
      classConfidence: 0.88,
      provenance: "Local SDR RTLSDR dump1090",
      id: "track-test-01",
      lat: 50.45,
      lon: 30.52,
      altitude: 4500,
      speed: 180,
      heading: 90
    });

    // Verify v2 contract fields
    expect(obs.schemaVersion).toBe(2);
    expect(obs.sourceId).toBe("sdr.receiver");
    expect(obs.source_id).toBe("sdr.receiver"); // backward compatibility alias
    expect(obs.sensorType).toBe("sdr");
    expect(obs.observedAt).toBe(now - 300);
    expect(obs.receivedAt).toBe(now);
    expect(obs.ageMs).toBeGreaterThanOrEqual(300);
    expect(obs.latency).toBe(45);
    expect(obs.clockOffset).toBe(120);
    expect(obs.jitter).toBe(15);
    expect(obs.uncertaintyRadius).toBe(35);
    expect(obs.resolution).toBe(15);
    expect(obs.positionConfidence).toBe(0.95);
    expect(obs.classConfidence).toBe(0.88);
    expect(obs.provenance).toBe("Local SDR RTLSDR dump1090");
    expect(obs.rawEvidenceHash).toMatch(/^[a-f0-9]{16}$/);

    // Verify conversion to standard domain Observation
    const domainObs = toObservation(obs);
    expect(domainObs.id).toBe("track-test-01");
    expect(domainObs.lat).toBe(50.45);
    expect(domainObs.confidence).toBe(0.95);
    expect(domainObs.meta?.source_id).toBe("sdr.receiver");
    expect(domainObs.meta?.raw_evidence_hash).toBe(obs.rawEvidenceHash);
  });

  it("evaluates observation freshness: fresh, decayed, and expired TTL", () => {
    const now = 1700000000000;

    // 1. Fresh observation (age 5 seconds, maxAge 60s)
    const freshObs = createUnifiedObservation({
      sourceId: "airplanes.live",
      sensorType: "adsb",
      observedAt: now - 5000,
      receivedAt: now,
      positionConfidence: 0.90,
      lat: 50.0,
      lon: 30.0
    });
    const freshResult = evaluateObservationFreshness(freshObs, now, 60000);
    expect(freshResult.valid).toBe(true);
    expect(freshResult.positionConfidence).toBe(0.90);

    // 2. Decaying observation (age 40 seconds, maxAge 60s, decay begins at 30s)
    const decayingObs = createUnifiedObservation({
      sourceId: "airplanes.live",
      sensorType: "adsb",
      observedAt: now - 45000,
      receivedAt: now,
      positionConfidence: 0.90,
      lat: 50.0,
      lon: 30.0
    });
    const decayingResult = evaluateObservationFreshness(decayingObs, now, 60000);
    expect(decayingResult.valid).toBe(true);
    expect(decayingResult.positionConfidence).toBeLessThan(0.90);
    expect(decayingResult.positionConfidence).toBeGreaterThan(0.2);

    // 3. Expired observation beyond TTL (age 70 seconds > maxAge 60s)
    const expiredObs = createUnifiedObservation({
      sourceId: "airplanes.live",
      sensorType: "adsb",
      observedAt: now - 70000,
      receivedAt: now,
      positionConfidence: 0.90,
      lat: 50.0,
      lon: 30.0
    });
    const expiredResult = evaluateObservationFreshness(expiredObs, now, 60000);
    expect(expiredResult.valid).toBe(false);
    expect(expiredResult.positionConfidence).toBe(0);
  });

  it("computes deterministic rawEvidenceHash", () => {
    const p1 = { a: 1, b: "xyz" };
    const p2 = { a: 1, b: "xyz" };
    const p3 = { a: 2, b: "xyz" };

    const h1 = computeRawEvidenceHash(p1);
    const h2 = computeRawEvidenceHash(p2);
    const h3 = computeRawEvidenceHash(p3);

    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});
