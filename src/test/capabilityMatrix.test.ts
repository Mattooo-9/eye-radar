import { describe, expect, it } from 'vitest';
import { SourceRegistry } from '../server/sources/SourceRegistry.js';
import { TrackManager } from '../server/core/trackManager.js';
import { SourceHealthTracker } from '../server/sources/sourceHealth.js';
import type { Observation } from '../server/domain/types.js';

describe('Source Capability Matrix & Evidence Family Separation', () => {
  it('strictly classifies sources into TRACK_POSITION, THREAT_ALERT, WEATHER, EARTH_OBSERVATION, TEST_SIMULATION', () => {
    const registry = new SourceRegistry();
    const health = new SourceHealthTracker();
    registry.setHealthTracker(health);

    registry.register('airplanes.live', 'adsb_mlat', {} as any, {
      primaryCapability: 'TRACK_POSITION',
      capabilities: ['TRACK_POSITION'],
      canCreateTrack: true,
      canClassify: false,
      canProvidePosition: true,
      canProvideAltitude: true,
      canProvideSpeed: true,
      evidenceFamily: 'adsb_mlat',
      evidenceTypes: ['adsb', 'mlat']
    });

    registry.register('adsb.lol', 'adsb_mlat', {} as any, {
      primaryCapability: 'TRACK_POSITION',
      capabilities: ['TRACK_POSITION'],
      canCreateTrack: true,
      canClassify: false,
      canProvidePosition: true,
      canProvideAltitude: true,
      canProvideSpeed: true,
      evidenceFamily: 'adsb_mlat',
      evidenceTypes: ['adsb', 'mlat']
    });

    registry.register('alerts.in.ua', 'threat_alert', {} as any, {
      primaryCapability: 'THREAT_ALERT',
      capabilities: ['THREAT_ALERT'],
      canCreateTrack: false,
      canClassify: false,
      canProvidePosition: false,
      canProvideAltitude: false,
      canProvideSpeed: false,
      evidenceFamily: 'threat_alert',
      evidenceTypes: ['alert']
    });

    registry.register('open-meteo', 'weather', {} as any, {
      primaryCapability: 'WEATHER',
      capabilities: ['WEATHER'],
      canCreateTrack: false,
      canClassify: false,
      canProvidePosition: false,
      canProvideAltitude: false,
      canProvideSpeed: false,
      evidenceFamily: 'weather',
      evidenceTypes: ['weather']
    });

    registry.register('earth-observation', 'earth_observation', {} as any, {
      primaryCapability: 'EARTH_OBSERVATION',
      capabilities: ['EARTH_OBSERVATION'],
      canCreateTrack: false,
      canClassify: false,
      canProvidePosition: false,
      canProvideAltitude: false,
      canProvideSpeed: false,
      evidenceFamily: 'earth_observation',
      evidenceTypes: ['sar', 'optical']
    });

    registry.register('simulator', 'test_simulation', {} as any, {
      primaryCapability: 'TEST_SIMULATION',
      capabilities: ['TEST_SIMULATION'],
      canCreateTrack: true,
      canClassify: true,
      canProvidePosition: true,
      canProvideAltitude: true,
      canProvideSpeed: true,
      evidenceFamily: 'test_simulation',
      evidenceTypes: ['synthetic_aerodynamics']
    });

    // Mark sources as LIVE
    const now = Date.now();
    health.recordSuccess('airplanes.live', 50, 1, now);
    health.recordSuccess('adsb.lol', 60, 1, now);
    health.recordSuccess('alerts.in.ua', 30, 1, now);
    health.recordSuccess('open-meteo', 40, 1, now);
    health.recordSuccess('simulator', 1, 1, now);

    const livePositional = registry.getLivePositionalSources().map(s => s.name);
    const liveContextual = registry.getLiveContextualSources().map(s => s.name);
    const testSources = registry.getTestSources().map(s => s.name);

    // LIVE positional MUST only contain coordinate providers (adsb.lol, airplanes.live)
    expect(livePositional).toContain('airplanes.live');
    expect(livePositional).toContain('adsb.lol');
    expect(livePositional).not.toContain('alerts.in.ua'); // Alerts is NOT positional
    expect(livePositional).not.toContain('simulator');    // Simulator is NOT live positional

    // LIVE contextual MUST contain alerts, weather, etc.
    expect(liveContextual).toContain('alerts.in.ua');
    expect(liveContextual).toContain('open-meteo');

    // TEST sources contains simulator
    expect(testSources).toContain('simulator');
  });

  it('prevents non-positional sources from creating aerial target tracks', () => {
    const registry = new SourceRegistry();
    const tm = new TrackManager(registry);

    registry.register('alerts.in.ua', 'threat_alert', {} as any, {
      primaryCapability: 'THREAT_ALERT',
      capabilities: ['THREAT_ALERT'],
      canCreateTrack: false,
      canClassify: false,
      canProvidePosition: false,
      canProvideAltitude: false,
      canProvideSpeed: false,
      evidenceFamily: 'threat_alert',
      evidenceTypes: ['alert']
    });

    const illegalObs: Observation = {
      id: 'illegal-track-01',
      type: 'uav',
      lat: 50.45,
      lon: 30.52,
      timestamp: Date.now(),
      source: 'alerts.in.ua' as any,
      confidence: 0.9
    };

    const res = tm.ingest(illegalObs);
    expect(res).toBeNull();
    expect(tm.snapshot().length).toBe(0);
  });

  it('unifies adsb.lol and airplanes.live in one evidence family and does not grant false multi-sensor bonus', () => {
    const registry = new SourceRegistry();
    const tm = new TrackManager(registry);

    registry.register('airplanes.live', 'adsb_mlat', {} as any, {
      primaryCapability: 'TRACK_POSITION',
      capabilities: ['TRACK_POSITION'],
      canCreateTrack: true,
      canClassify: false,
      canProvidePosition: true,
      canProvideAltitude: true,
      canProvideSpeed: true,
      evidenceFamily: 'adsb_mlat',
      evidenceTypes: ['adsb', 'mlat']
    });

    registry.register('adsb.lol', 'adsb_mlat', {} as any, {
      primaryCapability: 'TRACK_POSITION',
      capabilities: ['TRACK_POSITION'],
      canCreateTrack: true,
      canClassify: false,
      canProvidePosition: true,
      canProvideAltitude: true,
      canProvideSpeed: true,
      evidenceFamily: 'adsb_mlat',
      evidenceTypes: ['adsb', 'mlat']
    });

    const now = Date.now();
    const obs1: Observation = {
      id: 'recon-flight-01',
      type: 'aircraft',
      lat: 48.5,
      lon: 31.5,
      heading: 90,
      speed: 180,
      altitude: 7000,
      timestamp: now,
      source: 'airplanes.live' as any,
      confidence: 0.7,
      meta: { source_id: 'airplanes.live', model: 'MIG29' }
    };

    const track1 = tm.ingest(obs1);
    expect(track1).not.toBeNull();

    // Second observation from adsb.lol on the same flight 1 second later
    const obs2: Observation = {
      id: 'recon-flight-01',
      type: 'aircraft',
      lat: 48.501,
      lon: 31.502,
      heading: 90,
      speed: 180,
      altitude: 7000,
      timestamp: now + 1000,
      source: 'adsb.lol' as any,
      confidence: 0.7,
      meta: { source_id: 'adsb.lol', model: 'MIG29' }
    };

    const track2 = tm.ingest(obs2);
    expect(track2).not.toBeNull();

    // Verify evidence families: both adsb feeds mapped to 'adsb' family
    expect(track2!.evidenceFamilies).toEqual(['adsb']);
    expect(track2!.sources.size).toBe(2);
    expect(track2!.confidence).toBeLessThan(0.75);
  });
});
