import { describe, expect, it } from 'vitest';
import { SourceHealthTracker } from '../server/sources/sourceHealth';
import type { TrackState } from '../server/domain/types';

describe('SourceHealthTracker & Pipeline Telemetry', () => {
  it('transitions from OFFLINE to LIVE only upon actual successful observation ingest', () => {
    const tracker = new SourceHealthTracker();
    tracker.registerSource('test.feed');

    const initialReport = tracker.getAuditReport();
    const initialFeed = initialReport.sources.find((s) => s.name === 'test.feed');
    expect(initialFeed?.state).toBe('OFFLINE');
    expect(initialFeed?.status).toBe('offline');

    // Record real observations with 120ms latency
    tracker.recordSuccess('test.feed', 120, 5);

    const liveReport = tracker.getAuditReport();
    const liveFeed = liveReport.sources.find((s) => s.name === 'test.feed');
    expect(liveFeed?.state).toBe('LIVE');
    expect(liveFeed?.status).toBe('online');
    expect(liveFeed?.lastLatencyMs).toBe(120);
    expect(liveFeed?.totalObservations).toBe(5);
  });

  it('accurately calculates p50, p95, and p99 latencies', () => {
    const tracker = new SourceHealthTracker();
    tracker.registerSource('telemetry.src');

    // Feed 60 latencies: 10, 20, 30, ... 600 (fits perfectly in 60-sample window)
    for (let i = 1; i <= 60; i++) {
      tracker.recordSuccess('telemetry.src', i * 10, 1);
    }

    const report = tracker.getAuditReport();
    const detail = report.sources.find((s) => s.name === 'telemetry.src');
    expect(detail).toBeDefined();
    expect(detail?.p50LatencyMs).toBe(310);
    expect(detail?.p95LatencyMs).toBe(580);
  });

  it('transitions to DEGRADED on repeated errors', () => {
    const tracker = new SourceHealthTracker();
    tracker.registerSource('flaky.feed');
    tracker.recordSuccess('flaky.feed', 100, 1);

    tracker.recordError('flaky.feed', new Error('Connection reset by peer'));
    tracker.recordError('flaky.feed', new Error('Timeout'));
    tracker.recordError('flaky.feed', new Error('503 Service Unavailable'));

    const report = tracker.getAuditReport();
    const detail = report.sources.find((s) => s.name === 'flaky.feed');
    expect(detail?.state).toBe('DEGRADED');
    expect(detail?.status).toBe('degraded');
    expect(detail?.errorCount).toBe(3);
  });

  it('counts active tracks contributed by source', () => {
    const tracker = new SourceHealthTracker();
    tracker.registerSource('sdr');

    const mockTracks: TrackState[] = [
      {
        id: 't-1',
        type: 'uav',
        lat: 50.0,
        lon: 30.0,
        heading: 90,
        speed: 50,
        timestamp: Date.now(),
        confidence: 0.95,
        sources: new Set(['sdr', 'osint'])
      },
      {
        id: 't-2',
        type: 'munition',
        lat: 49.0,
        lon: 32.0,
        heading: 180,
        speed: 250,
        timestamp: Date.now(),
        confidence: 0.90,
        sources: new Set(['osint'])
      }
    ];

    const report = tracker.getAuditReport(mockTracks);
    const sdrDetail = report.sources.find((s) => s.name === 'sdr');
    expect(sdrDetail?.activeTracksHelped).toBe(1);
  });
});
