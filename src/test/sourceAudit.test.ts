import { describe, expect, it } from "vitest";
import { SourceHealthTracker } from "../server/sources/sourceHealth.js";
import type { TrackState } from "../server/domain/types.js";

describe("SourceHealthTracker & Automated Audit", () => {
  it("initializes sources in OFFLINE state until successful ingest occurs in current session", () => {
    const tracker = new SourceHealthTracker();
    const report = tracker.getAuditReport([]);

    expect(report.sources.length).toBeGreaterThan(0);
    // Every registered source without a recordSuccess in this session must be OFFLINE
    for (const src of report.sources) {
      expect(src.state).toBe("OFFLINE");
      expect(src.trustScore).toBe(0);
    }
    expect(report.summary.offlineSources).toBe(report.sources.length);
    expect(report.summary.liveSources).toBe(0);
  });

  it("transitions source to LIVE with low latency and tracks p50/p95/p99 percentiles", () => {
    const tracker = new SourceHealthTracker();
    const now = Date.now();

    // Record 5 successful updates for airplanes.live
    tracker.recordSuccess("airplanes.live", 45, 1, now - 4000);
    tracker.recordSuccess("airplanes.live", 50, 1, now - 3000);
    tracker.recordSuccess("airplanes.live", 55, 1, now - 2000);
    tracker.recordSuccess("airplanes.live", 60, 1, now - 1000);
    tracker.recordSuccess("airplanes.live", 48, 1, now);

    const report = tracker.getAuditReport([]);
    const source = report.sources.find((s) => s.name === "airplanes.live");

    expect(source).toBeDefined();
    expect(source?.state).toBe("LIVE");
    expect(source?.totalObservations).toBe(5);
    expect(source?.lastLatencyMs).toBe(48);
    expect(source?.p50LatencyMs).toBeGreaterThan(0);
    expect(source?.trustScore).toBeGreaterThan(0.7);
    expect(source?.updateFrequencyHz).toBeGreaterThan(0);
  });

  it("transitions to DEGRADED on repeated errors or excessive latency", () => {
    const tracker = new SourceHealthTracker();
    const now = Date.now();

    // First make it active
    tracker.recordSuccess("opensky", 120, 1, now - 5000);

    // Then record 4 errors
    tracker.recordError("opensky", "Rate limit 429");
    tracker.recordError("opensky", "Rate limit 429");
    tracker.recordError("opensky", "Rate limit 429");
    tracker.recordError("opensky", "Rate limit 429");

    const report = tracker.getAuditReport([]);
    const source = report.sources.find((s) => s.name === "opensky");

    expect(source?.state).toBe("DEGRADED");
    expect(source?.errorCount).toBe(4);
    expect(source?.lastError).toContain("Rate limit");
  });

  it("counts activeTracksHelped accurately from provenance chains", () => {
    const tracker = new SourceHealthTracker();
    const mockTracks: TrackState[] = [
      {
        id: "tr-1",
        type: "uav",
        lat: 49.0,
        lon: 31.0,
        speed: 55,
        heading: 270,
        timestamp: Date.now(),
        confidence: 0.9,
        threatLevel: "critical",
        uncertaintyRadius: 150,
        sources: new Set(["sdr" as const]),
        provenanceChain: [
          {
            source: "airplanes.live",
            sourceFamily: "adsb",
            observedAt: Date.now() - 5000,
            receivedAt: Date.now() - 4000,
            processedAt: Date.now() - 3900,
            latencyMs: 1000,
            confidence: 0.9,
            evidence: []
          }
        ]
      },
      {
        id: "tr-2",
        type: "munition",
        lat: 50.0,
        lon: 30.0,
        speed: 210,
        heading: 180,
        timestamp: Date.now(),
        confidence: 0.85,
        threatLevel: "critical",
        uncertaintyRadius: 200,
        sources: new Set(["sdr" as const]),
        provenanceChain: [
          {
            source: "adsb.lol",
            sourceFamily: "adsb",
            observedAt: Date.now() - 8000,
            receivedAt: Date.now() - 7000,
            processedAt: Date.now() - 6900,
            latencyMs: 1000,
            confidence: 0.85,
            evidence: []
          },
          {
            source: "airplanes.live",
            sourceFamily: "adsb",
            observedAt: Date.now() - 6000,
            receivedAt: Date.now() - 5000,
            processedAt: Date.now() - 4900,
            latencyMs: 1000,
            confidence: 0.88,
            evidence: []
          }
        ]
      }
    ];

    expect(tracker.countActiveTracksHelped("airplanes.live", mockTracks)).toBe(2);
    expect(tracker.countActiveTracksHelped("adsb.lol", mockTracks)).toBe(1);
    expect(tracker.countActiveTracksHelped("nasa-firms", mockTracks)).toBe(0);
  });
});
