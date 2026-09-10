export interface SourceStatus {
  name: string;
  status: "online" | "degraded" | "offline";
  lastSuccess: number;
  lastLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorCount: number;
  successCount: number;
  dynamicWeight: number; // 0.1 to 1.0 for fusion weighting
  lastError?: string;
}

interface SourceInternalStats {
  name: string;
  status: "online" | "degraded" | "offline";
  lastSuccess: number;
  lastLatencyMs: number;
  errorCount: number;
  successCount: number;
  lastError?: string;
  latencies: number[]; // circular buffer of last 50 latencies
}

function calculatePercentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

export class SourceHealthTracker {
  private sources = new Map<string, SourceInternalStats>();

  registerSource(name: string): void {
    this.sources.set(name, {
      name,
      status: "online",
      lastSuccess: Date.now(),
      lastLatencyMs: 0,
      errorCount: 0,
      successCount: 0,
      latencies: []
    });
  }

  recordSuccess(name: string, latencyMs: number): void {
    const s = this.sources.get(name) ?? {
      name,
      status: "online",
      lastSuccess: Date.now(),
      lastLatencyMs: latencyMs,
      errorCount: 0,
      successCount: 0,
      latencies: []
    };

    s.status = "online";
    s.lastSuccess = Date.now();
    s.lastLatencyMs = latencyMs;
    s.successCount += 1;

    s.latencies.push(latencyMs);
    if (s.latencies.length > 60) {
      s.latencies.shift();
    }

    if (s.errorCount > 0) {
      s.errorCount = Math.max(0, s.errorCount - 1);
    }

    this.sources.set(name, s);
  }

  recordError(name: string, err: Error | string): void {
    const s = this.sources.get(name) ?? {
      name,
      status: "online",
      lastSuccess: 0,
      lastLatencyMs: 0,
      errorCount: 0,
      successCount: 0,
      latencies: []
    };

    s.errorCount += 1;
    s.lastError = typeof err === "string" ? err : err.message;

    if (s.errorCount >= 3 && s.errorCount < 10) {
      s.status = "degraded";
    } else if (s.errorCount >= 10) {
      s.status = "offline";
    }

    this.sources.set(name, s);
  }

  getSourceWeight(name: string): number {
    const s = this.sources.get(name);
    if (!s) return 0.5;
    if (s.status === "offline") return 0.1;
    if (s.status === "degraded") return 0.4;

    const p95 = calculatePercentile(s.latencies, 95);
    // Latency penalty if source has high lag > 3000ms
    if (p95 > 5000) return 0.6;
    if (p95 > 2500) return 0.8;
    return 1.0;
  }

  getStatuses(): SourceStatus[] {
    return [...this.sources.values()].map((s) => {
      const p50 = calculatePercentile(s.latencies, 50);
      const p95 = calculatePercentile(s.latencies, 95);
      const p99 = calculatePercentile(s.latencies, 99);
      const dynamicWeight = this.getSourceWeight(s.name);

      return {
        name: s.name,
        status: s.status,
        lastSuccess: s.lastSuccess,
        lastLatencyMs: s.lastLatencyMs,
        p50LatencyMs: p50,
        p95LatencyMs: p95,
        p99LatencyMs: p99,
        errorCount: s.errorCount,
        successCount: s.successCount,
        dynamicWeight,
        lastError: s.lastError
      };
    });
  }
}
