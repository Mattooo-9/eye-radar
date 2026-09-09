export interface SourceStatus {
  name: string;
  status: "online" | "degraded" | "offline";
  lastSuccess: number;
  lastLatencyMs: number;
  errorCount: number;
  lastError?: string;
}

export class SourceHealthTracker {
  private sources = new Map<string, SourceStatus>();

  registerSource(name: string): void {
    this.sources.set(name, {
      name,
      status: "online",
      lastSuccess: Date.now(),
      lastLatencyMs: 0,
      errorCount: 0
    });
  }

  recordSuccess(name: string, latencyMs: number): void {
    const s = this.sources.get(name) ?? {
      name,
      status: "online",
      lastSuccess: Date.now(),
      lastLatencyMs: latencyMs,
      errorCount: 0
    };
    s.status = "online";
    s.lastSuccess = Date.now();
    s.lastLatencyMs = latencyMs;
    this.sources.set(name, s);
  }

  recordError(name: string, err: Error | string): void {
    const s = this.sources.get(name) ?? {
      name,
      status: "online",
      lastSuccess: 0,
      lastLatencyMs: 0,
      errorCount: 0
    };
    s.errorCount += 1;
    s.lastError = typeof err === "string" ? err : err.message;
    if (s.errorCount >= 3) {
      s.status = "degraded";
    }
    if (s.errorCount >= 10) {
      s.status = "offline";
    }
    this.sources.set(name, s);
  }

  getStatuses(): SourceStatus[] {
    return [...this.sources.values()];
  }
}
