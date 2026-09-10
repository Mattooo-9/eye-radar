import type { TrackState } from "../domain/types.js";

export type SourceAuditState = "LIVE" | "DEGRADED" | "STALE" | "OFFLINE";

export interface SourceAuditDetail {
  name: string;
  state: SourceAuditState;
  status: "online" | "degraded" | "offline";
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
    degradedSources: number;
    staleSources: number;
    offlineSources: number;
    overallHealth: "HEALTHY" | "DEGRADED" | "CRITICAL";
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
  "alerts.in.ua",
  "airplanes.live",
  "adsb.lol",
  "opensky",
  "nasa-firms",
  "open-meteo",
  "public.osint"
];

export class SourceHealthTracker {
  private sources = new Map<string, SourceInternalStats>();

  constructor() {
    for (const name of DEFAULT_KNOWN_SOURCES) {
      this.registerSource(name);
    }
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
      latencies: [],
      updateTimestamps: []
    };

    s.lastSuccess = now;
    s.lastReceivedAt = now;
    s.lastObservedAt = observedAt ?? (now - latencyMs);
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
      latencies: [],
      updateTimestamps: []
    };

    s.errorCount += 1;
    s.lastError = typeof err === "string" ? err : err.message;
    this.sources.set(name, s);
  }

  calculateState(s: SourceInternalStats, now = Date.now()): SourceAuditState {
    // 1. Never successfully connected in current session = OFFLINE
    if (s.successCount === 0 || s.lastSuccess === 0) {
      return "OFFLINE";
    }

    // 2. High error count = DEGRADED
    if (s.errorCount >= 3) {
      return "DEGRADED";
    }

    // 3. Stale: no successful update in over 45 seconds
    if (now - s.lastSuccess > 45_000) {
      return "STALE";
    }

    // 4. Fully operational with recent successful data
    return "LIVE";
  }

  calculateTrustScore(s: SourceInternalStats, state: SourceAuditState): number {
    if (state === "OFFLINE") return 0.0;
    if (state === "STALE") return 0.3;
    if (state === "DEGRADED") return 0.5;

    const p95 = calculatePercentile(s.latencies, 95);
    let score = 0.95;

    // Latency degradation
    if (p95 > 5000) score -= 0.25;
    else if (p95 > 2500) score -= 0.1;

    // Success consistency
    if (s.successCount > 10 && s.errorCount === 0) {
      score = Math.min(1.0, score + 0.05);
    }

    return Math.round(score * 100) / 100;
  }

  getSourceWeight(name: string): number {
    const s = this.sources.get(name);
    if (!s) return 0.5;
    const state = this.calculateState(s);
    if (state === "OFFLINE") return 0.1;
    if (state === "STALE") return 0.3;
    if (state === "DEGRADED") return 0.5;

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
    let degradedCount = 0;
    let staleCount = 0;
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
      else if (state === "DEGRADED") degradedCount++;
      else if (state === "STALE") staleCount++;
      else if (state === "OFFLINE") offlineCount++;

      const status: "online" | "degraded" | "offline" =
        state === "LIVE" ? "online" : state === "DEGRADED" ? "degraded" : "offline";

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
      liveCount >= 3 && degradedCount === 0
        ? "HEALTHY"
        : liveCount > 0
        ? "DEGRADED"
        : "CRITICAL";

    return {
      timestamp: now,
      summary: {
        totalSources: this.sources.size,
        liveSources: liveCount,
        degradedSources: degradedCount,
        staleSources: staleCount,
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
