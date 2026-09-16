import { describe, expect, it } from 'vitest';
import { backendAiEngine, AERODYNAMIC_ENVELOPES } from '../server/core/backendAiEngine.js';
import type { TrackState } from '../server/domain/types.js';

describe('Backend AI Engine: Anomaly & Quality Scoring', () => {
  it('identifies compliant Shahed-136 kinematics as non-anomalous', () => {
    const shahedTrack: TrackState = {
      id: 'tr-shd-01',
      type: 'uav',
      lat: 50.45,
      lon: 30.52,
      heading: 180,
      speed: 52.5, // ~189 km/h (cruise speed)
      timestamp: Date.now(),
      confidence: 0.92,
      sources: new Set(['sdr']),
      altitude: 180
    };

    const res = backendAiEngine.scoreKinematicsAnomaly(shahedTrack);
    expect(res.isKinematicAnomaly).toBe(false);
    expect(res.anomalyScore).toBeLessThan(0.3);
    expect(res.confidence).toBeGreaterThan(0.7);
  });

  it('detects severe aerodynamic violations (e.g. UAV flying at Mach 3)', () => {
    const anomalousTrack: TrackState = {
      id: 'tr-fake-uav',
      type: 'uav',
      lat: 50.45,
      lon: 30.52,
      heading: 90,
      speed: 1050, // Mach 3 for a drone!
      timestamp: Date.now(),
      confidence: 0.5,
      sources: new Set(['sdr']),
      altitude: 28000 // 28 km high
    };

    const res = backendAiEngine.scoreKinematicsAnomaly(anomalousTrack);
    expect(res.isKinematicAnomaly).toBe(true);
    expect(res.anomalyScore).toBeGreaterThanOrEqual(0.5);
    expect(res.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('computes calibrated source quality based on latency and success rate', () => {
    // High quality low latency source
    const q1 = backendAiEngine.scoreSourceQuality('adsbUnified', 100, 2, 280);
    expect(q1).toBeGreaterThan(0.9);

    // Degraded high latency source with dropped packets
    const q2 = backendAiEngine.scoreSourceQuality('degraded-feed', 50, 50, 4200);
    expect(q2).toBeLessThan(0.6);
  });

  it('identifies close spatial duplicate clusters for multi-sensor deduplication', () => {
    const t1: TrackState = {
      id: 'sensor1-track',
      type: 'uav',
      lat: 50.4501,
      lon: 30.5234,
      heading: 120,
      speed: 50,
      timestamp: Date.now(),
      confidence: 0.9,
      sources: new Set(['sdr'])
    };
    const t2: TrackState = {
      id: 'sensor2-track',
      type: 'uav',
      lat: 50.4515,
      lon: 30.5248, // ~180m away
      heading: 122,
      speed: 51,
      timestamp: Date.now(),
      confidence: 0.75,
      sources: new Set(['sdr'])
    };

    const clusters = backendAiEngine.findDuplicateClusters([t1, t2]);
    expect(clusters.length).toBe(1);
    expect(clusters[0].primaryId).toBe('sensor1-track');
    expect(clusters[0].duplicateId).toBe('sensor2-track');
    expect(clusters[0].distanceMeters).toBeLessThan(300);
  });
});
