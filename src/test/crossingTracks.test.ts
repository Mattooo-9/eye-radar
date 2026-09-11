import { describe, expect, it } from 'vitest';
import { TrackCorrelator } from '../server/core/trackCorrelator';
import { TrackManager } from "../server/core/trackManager.ts";
import type { Observation, TrackState } from '../server/domain/types';

describe('Crossing Tracks, Gating & Reacquisition', () => {
  it('prevents false merges when two tracks cross each other with divergent headings', () => {
    const correlator = new TrackCorrelator(15_000);
    const now = Date.now();

    // Track 1: heading East (90 deg) at 50 m/s (~180 km/h)
    const track1: TrackState = {
      id: 'shahed-east',
      type: 'uav',
      lat: 50.0,
      lon: 30.0,
      heading: 90,
      speed: 50,
      timestamp: now - 2000,
      confidence: 0.9,
      sources: new Set(['sdr']),
      uncertaintyRadius: 200
    };

    // Track 2: heading South (180 deg) at 48 m/s (~173 km/h)
    const track2: TrackState = {
      id: 'shahed-south',
      type: 'uav',
      lat: 50.005,
      lon: 30.005,
      heading: 180,
      speed: 48,
      timestamp: now - 2000,
      confidence: 0.9,
      sources: new Set(['sdr']),
      uncertaintyRadius: 200
    };

    const activeTracks = [track1, track2];

    // New observation continuing Track 1 (heading 92 deg, East)
    const obsTrack1: Observation = {
      id: 'obs-1',
      type: 'uav',
      lat: 50.0,
      lon: 30.002,
      heading: 92,
      speed: 51,
      timestamp: now,
      source: 'sdr',
      confidence: 0.92
    };

    const match1 = correlator.findBestMatch(obsTrack1, activeTracks);
    expect(match1.matchedTrackId).toBe('shahed-east');

    // New observation continuing Track 2 (heading 182 deg, South)
    const obsTrack2: Observation = {
      id: 'obs-2',
      type: 'uav',
      lat: 49.998,
      lon: 30.005,
      heading: 182,
      speed: 49,
      timestamp: now,
      source: 'sdr',
      confidence: 0.92
    };

    const match2 = correlator.findBestMatch(obsTrack2, activeTracks);
    expect(match2.matchedTrackId).toBe('shahed-south');
  });

  it('rejects correlation when speeds are incompatible (speed gating)', () => {
    const correlator = new TrackCorrelator(20_000);
    const now = Date.now();

    const droneTrack: TrackState = {
      id: 'uav-piston',
      type: 'uav',
      lat: 50.45,
      lon: 30.52,
      heading: 270,
      speed: 48, // 48 m/s (~173 km/h)
      timestamp: now - 1000,
      confidence: 0.9,
      sources: new Set(['sdr']),
      uncertaintyRadius: 300
    };

    // Fast missile observation nearby at 250 m/s (~900 km/h)
    const missileObs: Observation = {
      id: 'fast-obs',
      type: 'munition',
      lat: 50.452,
      lon: 30.522,
      heading: 270,
      speed: 250, // 250 m/s
      timestamp: now,
      source: 'sdr',
      confidence: 0.95
    };

    const match = correlator.findBestMatch(missileObs, [droneTrack]);
    // Must NOT match because of type incompatibility and speed gating!
    expect(match.matchedTrackId).toBeNull();
  });

  it('successfully reacquires coasting track after temporary sensor signal gap', () => {
    const tm = new TrackManager();
    const t0 = Date.now();

    // 1. Initial detection
    tm.ingest({
      id: 'target-alpha',
      type: 'uav',
      lat: 49.0,
      lon: 31.0,
      heading: 45,
      speed: 50,
      timestamp: t0,
      source: 'sdr',
      confidence: 0.9
    }, t0);

    // 2. Second hit confirms
    tm.ingest({
      id: 'target-alpha',
      type: 'uav',
      lat: 49.001,
      lon: 31.001,
      heading: 45,
      speed: 50,
      timestamp: t0 + 2000,
      source: 'sdr',
      confidence: 0.92
    }, t0 + 2000);

    // 3. 7 seconds pass without measurements -> status transitions to COASTING
    tm.tick(t0 + 9000);
    const coastingTrack = tm.getTrack('target-alpha');
    expect(coastingTrack?.lifecycle).toBe('COASTING');

    // 4. Signal reacquired at predicted forward location
    const reacquired = tm.ingest({
      id: 'obs-reacquire',
      type: 'uav',
      lat: 49.004,
      lon: 31.004,
      heading: 45,
      speed: 50,
      timestamp: t0 + 10000,
      source: 'sdr',
      confidence: 0.88
    }, t0 + 10000);

    expect(reacquired).not.toBeNull();
    expect(reacquired?.id).toBe('target-alpha');
    expect(reacquired?.lifecycle).toBe('CONFIRMED');
  });
});
