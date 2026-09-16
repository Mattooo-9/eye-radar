/**
 * Source Time Calibration Service
 * 
 * Measures per-source:
 * - clock offset: difference between sensor clock and server clock adjusted for network transit
 * - jitter: variations in packet inter-arrival latency
 * - network latency: transport transit delay (receivedAt - publishedAt)
 * - publication delay: delay between raw observation and feed publication (publishedAt - observedAt)
 * 
 * Tracks rolling percentiles (p50, p95, p99) and calculates a normalized time confidence score (0.0 - 1.0).
 * Calibrates observedAt timestamps prior to IMM Kalman track fusion.
 */

export interface SourceTimeMetrics {
  sourceId: string;
  clockOffsetMs: number;
  jitterMs: number;
  networkLatencyMs: number;
  publicationDelayMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  timeConfidence: number;
  sampleCount: number;
  lastObservedAt: number;
  lastReceivedAt: number;
  lastCalibratedAt: number;
}

interface SourceInternalStats {
  sourceId: string;
  clockOffsetMs: number;
  jitterMs: number;
  networkLatencyMs: number;
  publicationDelayMs: number;
  sampleCount: number;
  lastObservedAt: number;
  lastReceivedAt: number;
  lastLatencyMs: number;
  latencies: number[]; // circular buffer of last 100 samples
}

function calculatePercentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

export class TimeCalibrationService {
  private sources = new Map<string, SourceInternalStats>();

  /**
   * Records observation timing metrics and returns the calibrated observation timestamp.
   */
  recordAndCalibrate(
    sourceId: string,
    observedAt: number,
    receivedAt = Date.now(),
    publishedAt?: number
  ): { calibratedTime: number; metrics: SourceTimeMetrics } {
    const pubAt = publishedAt && publishedAt > 0 ? publishedAt : receivedAt;
    const obsAt = Math.min(observedAt, receivedAt);

    let stat = this.sources.get(sourceId);
    if (!stat) {
      stat = {
        sourceId,
        clockOffsetMs: 0,
        jitterMs: 0,
        networkLatencyMs: 0,
        publicationDelayMs: 0,
        sampleCount: 0,
        lastObservedAt: obsAt,
        lastReceivedAt: receivedAt,
        lastLatencyMs: Math.max(0, receivedAt - obsAt),
        latencies: []
      };
      this.sources.set(sourceId, stat);
    }

    stat.sampleCount++;
    const totalLatency = Math.max(0, receivedAt - obsAt);
    const netLatency = Math.max(0, receivedAt - pubAt);
    const pubDelay = Math.max(0, pubAt - obsAt);

    // Instantaneous clock offset estimate (subtracting one-way transport delay approximation)
    const rawOffset = (receivedAt - obsAt) - (netLatency > 0 ? netLatency / 2 : totalLatency / 2);

    // Exponential moving average for clock offset (alpha = 0.15)
    if (stat.sampleCount === 1) {
      stat.clockOffsetMs = rawOffset;
      stat.jitterMs = 5;
      stat.networkLatencyMs = netLatency;
      stat.publicationDelayMs = pubDelay;
    } else {
      const alpha = 0.15;
      stat.clockOffsetMs = Math.round((1 - alpha) * stat.clockOffsetMs + alpha * rawOffset);

      // Jitter calculation: variation in packet transit latency
      const deltaLatency = Math.abs(totalLatency - stat.lastLatencyMs);
      const beta = 0.2;
      stat.jitterMs = Math.round((1 - beta) * stat.jitterMs + beta * deltaLatency);

      stat.networkLatencyMs = Math.round(0.8 * stat.networkLatencyMs + 0.2 * netLatency);
      stat.publicationDelayMs = Math.round(0.8 * stat.publicationDelayMs + 0.2 * pubDelay);
    }

    stat.lastLatencyMs = totalLatency;
    stat.lastObservedAt = obsAt;
    stat.lastReceivedAt = receivedAt;

    // Rolling latency circular buffer
    stat.latencies.push(totalLatency);
    if (stat.latencies.length > 100) {
      stat.latencies.shift();
    }

    const p50 = calculatePercentile(stat.latencies, 50);
    const p95 = calculatePercentile(stat.latencies, 95);
    const p99 = calculatePercentile(stat.latencies, 99);

    // Time Confidence: penalizes high jitter and large p95 latency
    // Perfect: 1.0; 500ms jitter drops ~37%; 10s latency clamped to 0.1
    const jitterFactor = Math.exp(-stat.jitterMs / 400);
    const latencyFactor = Math.max(0.1, Math.min(1.0, 1 - p95 / 15000));
    const timeConfidence = Math.round(jitterFactor * latencyFactor * 100) / 100;

    // Calibrated observation time: aligns sensor time with server clock reference
    // Never allows calibrated time to project into the future (> receivedAt)
    // or lag behind original observedAt if clock offset is positive
    const adjustedTime = obsAt + stat.clockOffsetMs;
    const calibratedTime = Math.min(receivedAt, Math.max(obsAt - 10000, adjustedTime));

    const metrics: SourceTimeMetrics = {
      sourceId,
      clockOffsetMs: stat.clockOffsetMs,
      jitterMs: stat.jitterMs,
      networkLatencyMs: stat.networkLatencyMs,
      publicationDelayMs: stat.publicationDelayMs,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      timeConfidence,
      sampleCount: stat.sampleCount,
      lastObservedAt: obsAt,
      lastReceivedAt: receivedAt,
      lastCalibratedAt: Date.now()
    };

    return { calibratedTime, metrics };
  }

  getMetrics(sourceId: string): SourceTimeMetrics | undefined {
    const stat = this.sources.get(sourceId);
    if (!stat) return undefined;
    const p50 = calculatePercentile(stat.latencies, 50);
    const p95 = calculatePercentile(stat.latencies, 95);
    const p99 = calculatePercentile(stat.latencies, 99);
    const jitterFactor = Math.exp(-stat.jitterMs / 400);
    const latencyFactor = Math.max(0.1, Math.min(1.0, 1 - p95 / 15000));
    const timeConfidence = Math.round(jitterFactor * latencyFactor * 100) / 100;

    return {
      sourceId,
      clockOffsetMs: stat.clockOffsetMs,
      jitterMs: stat.jitterMs,
      networkLatencyMs: stat.networkLatencyMs,
      publicationDelayMs: stat.publicationDelayMs,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      timeConfidence,
      sampleCount: stat.sampleCount,
      lastObservedAt: stat.lastObservedAt,
      lastReceivedAt: stat.lastReceivedAt,
      lastCalibratedAt: Date.now()
    };
  }

  getAllMetrics(): Record<string, SourceTimeMetrics> {
    const res: Record<string, SourceTimeMetrics> = {};
    for (const id of this.sources.keys()) {
      const m = this.getMetrics(id);
      if (m) res[id] = m;
    }
    return res;
  }

  reset(): void {
    this.sources.clear();
  }
}

export const timeCalibrationService = new TimeCalibrationService();
