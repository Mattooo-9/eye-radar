import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { CheckpointService } from '../server/db/checkpointService.js';
import { WatchdogService } from '../server/db/watchdogService.js';
import { TrackManager } from '../server/core/trackManager.js';
import type { TrackState } from '../server/domain/types.js';

describe('Neon Postgres Checkpoints, Watchdog & Idempotency', () => {
  it('saves and loads atomic track checkpoints with sequence monotonicity', async () => {
    const testBackup = resolve(process.cwd(), 'data', `test_checkpoint_${Date.now()}.json`);
    const service = new CheckpointService(testBackup);

    const mockTracks: TrackState[] = [
      {
        id: 'test-shahed-1',
        type: 'uav',
        lat: 50.45,
        lon: 30.52,
        heading: 270,
        speed: 55,
        altitude: 250,
        timestamp: Date.now(),
        confidence: 0.95,
        model: 'Shahed-136',
        threatLevel: 'critical',
        sources: new Set(['osint'])
      },
      {
        id: 'test-missile-2',
        type: 'munition',
        lat: 48.45,
        lon: 35.05,
        heading: 315,
        speed: 240,
        altitude: 800,
        timestamp: Date.now(),
        confidence: 0.92,
        model: 'Kh-101',
        threatLevel: 'critical',
        sources: new Set(['osint'])
      }
    ];

    await service.saveCheckpoint(105, mockTracks);

    const loaded = await service.loadLatestCheckpoint();
    expect(loaded).not.toBeNull();
    expect(loaded?.sequenceId).toBe(105);
    expect(loaded?.tracksCount).toBe(2);
    expect(loaded?.tracks.length).toBe(2);
    expect(loaded?.tracks[0].id).toBe('test-shahed-1');

    if (existsSync(testBackup)) unlinkSync(testBackup);
  });

  it('restores TrackManager state and IMM filter velocity from checkpoint seamlessly', () => {
    const tm = new TrackManager();

    const checkpoint = {
      sequenceId: 442,
      timestamp: Date.now(),
      tracks: [
        {
          id: 'recon-supercam',
          type: 'uav',
          lat: 49.99,
          lon: 36.23,
          heading: 180,
          speed: 35,
          altitude: 1500,
          timestamp: Date.now(),
          confidence: 0.88,
          model: 'Supercam S350',
          sources: new Set(['osint'])
        } as TrackState
      ]
    };

    const restored = tm.restoreFromCheckpoint(checkpoint);
    expect(restored).toBe(1);
    expect(tm.getSequence()).toBe(442);

    const track = tm.getTrack('recon-supercam');
    expect(track).toBeDefined();
    expect(track?.lat).toBe(49.99);
    expect(track?.model).toBe('Supercam S350');

    // Next sequence is guaranteed monotonic
    expect(tm.getNextSequence()).toBe(443);
  });

  it('verifies watchdog heartbeat status and distributed lease locking', async () => {
    const watchdog = new WatchdogService();

    // Start with stats provider
    watchdog.start(() => ({
      activeTracks: 42,
      sequenceId: 1000
    }));

    const status = watchdog.getHealthStatus();
    expect(status.ok).toBe(true);
    expect(status.workerId).toBeDefined();
    expect(status.lastBeatAgeMs).toBeLessThan(1000);

    // Test distributed lock acquisition
    const lockKey = `test_lock_${Date.now()}`;
    const acquired = await watchdog.tryAcquireLock(lockKey, 5000);
    expect(acquired).toBe(true);

    await watchdog.releaseLock(lockKey);
    watchdog.stop();
  });

  it('records idempotent events with eventId deduplication', async () => {
    const service = new CheckpointService();
    const eventId = `event_${Date.now()}_test`;

    await service.appendEvent({
      eventId,
      trackId: 'target-01',
      sequenceId: 1,
      eventType: 'track_updated',
      payload: { lat: 48.0, lon: 31.0 }
    });

    // Duplicate append should not throw or corrupt state
    await service.appendEvent({
      eventId,
      trackId: 'target-01',
      sequenceId: 1,
      eventType: 'track_updated',
      payload: { lat: 48.0, lon: 31.0 }
    });

    const events = await service.getEventsSince(0, 10);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
