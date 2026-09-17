import type { TrackState } from "../domain/types.js";
import { backendAiEngine } from "../core/backendAiEngine.js";
import { timeCalibrationService } from "../core/timeCalibration.js";

export type SourceAuditState = "LIVE" | "AVAILABLE" | "DEGRADED" | "OFFLINE";

export interface SourceAuditDetail {
  name: string;
  state: SourceAuditState;
  status: "online" | "available" | "degraded" | "offline";
  lastSuccess: number;
  lastObservedAt: number;
  lastReceivedAt: number;
  lastEventTime: number;
  lastLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  updateFrequencyHz: number;
  totalObservations: number;
  activeTracksHelped: number;
  errorCount: number;
  successCount: number;
  trustScore: number;       // 0.0 to 1.0
  dynamicWeight: number;    // 0.1 to 1.0 for fusion weighting
  lastError?: string;
}

export interface SourceAuditReport {
  timestamp: number;
  summary: {
    totalSources: number;
    liveSources: number;
    availableSources: number;
    degradedSources: number;
    staleSources?: number;
    offlineSources: number;
    overallHealth: "HEALTHY" | "DEGRADED" | "CRITICAL";
    livePositionalSources?: string[];
    liveContextualSources?: string[];
    testSources?: string[];
    offlineSourcesList?: string[];
  };
  sources: SourceAuditDetail[];
}

interface SourceInternalStats {
  name: string;
  lastSuccess: number;
  lastObservedAt: number;
  lastReceivedAt: number;
  lastLatencyMs: number;
  errorCount: number;
  successCount: number;
  totalObservations: number;
  recentObservationsCount?: number;
  lastError?: string;
  latencies: number[]; // circular buffer of last 60 latencies
  updateTimestamps: number[]; // timestamps of last 30 updates to compute Hz
}

function calculatePercentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

const DEFAULT_KNOWN_SOURCES = [
  "airplanes.live",
  "adsb.lol",
  "opensky.live",
  "sdr.receiver",
  "ground.sensor",
  "satellite.eo_coords",
  "alerts.in.ua",
  "open-meteo",
  "nasa-firms",
  "earth-observation",
  "simulator",
  "local.sdr",
  "public.osint"
];

export class SourceHealthTracker {
  private sources = new Map<string, SourceInternalStats>();

  constructor() {
    for (const name of DEFAULT_KNOWN_SOURCES) {
      this.registerSource(name);
    }
  }

  getSource(name: string): SourceInternalStats | undefined {
    return this.sources.get(name);
  }

  getSourceState(name: string, now = Date.now()): SourceAuditState {
    const s = this.sources.get(name);
    if (!s) return "OFFLINE";
    return this.calculateState(s, now);
  }

  registerSource(name: string): void {
    if (!this.sources.has(name)) {
      this.sources.set(name, {
        name,
        lastSuccess: 0,
        lastObservedAt: 0,
        lastReceivedAt: 0,
        lastLatencyMs: 0,
        errorCount: 0,
        successCount: 0,
        totalObservations: 0,
        recentObservationsCount: 0,
        latencies: [],
        updateTimestamps: []
      });
    }
  }

  recordSuccess(
    name: string,
    latencyMs: number,
    observationsCount = 1,
    observedAt?: number
  ): void {
    const now = Date.now();
    const s = this.sources.get(name) ?? {
      name,
      lastSuccess: 0,
      lastObservedAt: 0,
      lastReceivedAt: 0,
      lastLatencyMs: latencyMs,
      errorCount: 0,
      successCount: 0,
      totalObservations: 0,
      recentObservationsCount: 0,
      latencies: [],
      updateTimestamps: []
    };

    s.lastSuccess = now;
    s.lastReceivedAt = now;
    s.recentObservationsCount = observationsCount;
    if (observationsCount > 0) {
      s.lastObservedAt = observedAt ?? (now - latencyMs);
    }
    s.lastLatencyMs = latencyMs;
    s.successCount += 1;
    s.totalObservations += observationsCount;

    s.latencies.push(latencyMs);
    if (s.latencies.length > 60) {
      s.latencies.shift();
    }

    s.updateTimestamps.push(now);
    if (s.updateTimestamps.length > 30) {
      s.updateTimestamps.shift();
    }

    if (s.errorCount > 0) {
      s.errorCount = Math.max(0, s.errorCount - 1);
    }

    this.sources.set(name, s);
  }

  recordError(name: string, err: Error | string): void {
    const s = this.sources.get(name) ?? {
      name,
      lastSuccess: 0,
      lastObservedAt: 0,
      lastReceivedAt: 0,
      lastLatencyMs: 0,
      errorCount: 0,
      successCount: 0,
      totalObservations: 0,
      recentObservationsCount: 0,
      latencies: [],
      updateTimestamps: []
    };

    s.errorCount += 1;
    s.lastError = typeof err === "string" ? err : err.message;
    this.sources.set(name, s);
  }

  calculateState(s: SourceInternalStats, now = Date.now()): SourceAuditState {
    // 1. Never successfully connected or no successful contact for > 60 seconds = OFFLINE
    if (s.successCount === 0 || s.lastSuccess === 0 || now - s.lastSuccess > 60_000) {
      return "OFFLINE";
    }

    // 2. High error count, excessive latency, or unstable sensor clock/jitter = DEGRADED
    if (s.errorCount >= 3 || s.lastLatencyMs > 5000 || timeCalibrationService.isTimingDegraded(s.name)) {
      return "DEGRADED";
    }

    // 3. LIVE vs AVAILABLE:
    // Real LIVE status strictly requires an active stream with recent observations received in sector
    const hasRecentObs = s.lastObservedAt > 0 && now - s.lastObservedAt <= 45_000;
    const hasObsCount = (s.recentObservationsCount !== undefined ? s.recentObservationsCount > 0 : s.totalObservations > 0);

    if (hasRecentObs && hasObsCount) {
      return "LIVE";
    }

    // Endpoint is reachable, healthy, valid payload schema, but currently 0 active targets in monitored sector
    return "AVAILABLE";
  }

  calculateTrustScore(s: SourceInternalStats, state: SourceAuditState): number {
    if (state === "OFFLINE") return 0.0;
    if (state === "DEGRADED") return 0.4;
    if (state === "AVAILABLE") return 0.85;
    const p95 = calculatePercentile(s.latencies, 95);
    return backendAiEngine.scoreSourceQuality(s.name, s.successCount, s.errorCount, p95);
  }

  getSourceWeight(name: string): number {
    const s = this.sources.get(name);
    if (!s) return 0.5;
    const state = this.calculateState(s);
    if (state === "OFFLINE") return 0.1;
    if (state === "DEGRADED") return 0.5;
    if (state === "AVAILABLE") return 0.75;

    const p95 = calculatePercentile(s.latencies, 95);
    if (p95 > 5000) return 0.6;
    if (p95 > 2500) return 0.8;
    return 1.0;
  }

  computeUpdateFrequencyHz(s: SourceInternalStats): number {
    if (s.updateTimestamps.length < 2) return 0;
    const oldest = s.updateTimestamps[0];
    const newest = s.updateTimestamps[s.updateTimestamps.length - 1];
    const durationSec = Math.max(0.5, (newest - oldest) / 1000);
    const hz = (s.updateTimestamps.length - 1) / durationSec;
    return Math.round(hz * 100) / 100;
  }

  countActiveTracksHelped(sourceName: string, tracks: TrackState[]): number {
    let count = 0;
    const lower = sourceName.toLowerCase();
    for (const t of tracks) {
      let helped = false;
      // Check direct source kinds
      for (const src of t.sources) {
        if (lower.includes(src) || src.includes(lower)) {
          helped = true;
          break;
        }
      }
      // Check provenance chain
      if (!helped && t.provenanceChain) {
        for (const p of t.provenanceChain) {
          if (p.source.toLowerCase().includes(lower) || lower.includes(p.source.toLowerCase())) {
            helped = true;
            break;
          }
        }
      }
      if (helped) count++;
    }
    return count;
  }

  getAuditReport(tracks: TrackState[] = []): SourceAuditReport {
    const now = Date.now();
    const details: SourceAuditDetail[] = [];

    let liveCount = 0;
    let availableCount = 0;
    let degradedCount = 0;
    let offlineCount = 0;

    for (const s of this.sources.values()) {
      const state = this.calculateState(s, now);
      const trustScore = this.calculateTrustScore(s, state);
      const dynamicWeight = this.getSourceWeight(s.name);
      const p50 = calculatePercentile(s.latencies, 50);
      const p95 = calculatePercentile(s.latencies, 95);
      const p99 = calculatePercentile(s.latencies, 99);
      const hz = this.computeUpdateFrequencyHz(s);
      const activeTracksHelped = this.countActiveTracksHelped(s.name, tracks);

      if (state === "LIVE") liveCount++;
      else if (state === "AVAILABLE") availableCount++;
      else if (state === "DEGRADED") degradedCount++;
      else if (state === "OFFLINE") offlineCount++;

      const status: "online" | "available" | "degraded" | "offline" =
        state === "LIVE" ? "online" : state === "AVAILABLE" ? "available" : state === "DEGRADED" ? "degraded" : "offline";

      details.push({
        name: s.name,
        state,
        status,
        lastSuccess: s.lastSuccess,
        lastObservedAt: s.lastObservedAt,
        lastReceivedAt: s.lastReceivedAt,
        lastEventTime: s.lastObservedAt || s.lastSuccess,
        lastLatencyMs: s.lastLatencyMs,
        p50LatencyMs: p50,
        p95LatencyMs: p95,
        p99LatencyMs: p99,
        updateFrequencyHz: hz,
        totalObservations: s.totalObservations,
        activeTracksHelped,
        errorCount: s.errorCount,
        successCount: s.successCount,
        trustScore,
        dynamicWeight,
        lastError: s.lastError
      });
    }

    const overallHealth =
      (liveCount + availableCount) >= 3 && degradedCount === 0
        ? "HEALTHY"
        : (liveCount > 0 || availableCount > 0)
        ? "DEGRADED"
        : "CRITICAL";

    return {
      timestamp: now,
      summary: {
        totalSources: this.sources.size,
        liveSources: liveCount,
        availableSources: availableCount,
        degradedSources: degradedCount,
        staleSources: 0,
        offlineSources: offlineCount,
        overallHealth
      },
      sources: details
    };
  }

  // Backward compatible method
  getStatuses(): SourceAuditDetail[] {
    return this.getAuditReport().sources;
  }
}
