// src/server/db/watchdogService.ts
import { getPool, query } from "./pool.js";

export interface WatchdogStats {
  workerId: string;
  uptimeSeconds: number;
  activeTracks: number;
  sequenceId: number;
  memoryMb: number;
  lastHeartbeatAt: number;
  status: "healthy" | "degraded" | "unhealthy";
}

export class WatchdogService {
  private timer?: NodeJS.Timeout;
  private workerId: string;
  private startTime = Date.now();
  private statsProvider?: () => { activeTracks: number; sequenceId: number };
  private lastHeartbeatTime = Date.now();

  constructor() {
    this.workerId =
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RENDER_SERVICE_ID ||
      process.env.HOSTNAME ||
      `worker-${Math.random().toString(36).slice(2, 8)}`;
  }

  start(statsProvider: () => { activeTracks: number; sequenceId: number }): void {
    this.statsProvider = statsProvider;
    this.startTime = Date.now();

    // Heartbeat every 4 seconds
    this.timer = setInterval(() => {
      void this.beat();
    }, 4_000);
    this.timer.unref();

    void this.beat();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async beat(): Promise<void> {
    const pool = getPool();
    if (!pool) return;

    const stats = this.statsProvider ? this.statsProvider() : { activeTracks: 0, sequenceId: 0 };
    const now = Date.now();
    const uptime = Math.floor((now - this.startTime) / 1000);
    const memMb = Math.round(process.memoryUsage().rss / (1024 * 1024));

    this.lastHeartbeatTime = now;

    try {
      await query(
        `INSERT INTO worker_watchdog (worker_id, last_heartbeat_at, status, uptime_seconds, active_tracks, sequence_id, memory_mb, updated_at)
         VALUES ($1, $2, 'healthy', $3, $4, $5, $6, NOW())
         ON CONFLICT (worker_id) DO UPDATE SET
           last_heartbeat_at = EXCLUDED.last_heartbeat_at,
           status = 'healthy',
           uptime_seconds = EXCLUDED.uptime_seconds,
           active_tracks = EXCLUDED.active_tracks,
           sequence_id = EXCLUDED.sequence_id,
           memory_mb = EXCLUDED.memory_mb,
           updated_at = NOW()`,
        [this.workerId, now, uptime, stats.activeTracks, stats.sequenceId, memMb]
      );
    } catch {
      // Non-blocking heartbeat write failure
    }
  }

  getHealthStatus(): { ok: boolean; workerId: string; uptimeSeconds: number; memoryMb: number; lastBeatAgeMs: number } {
    const now = Date.now();
    const age = now - this.lastHeartbeatTime;
    const memMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    const uptime = Math.floor((now - this.startTime) / 1000);

    return {
      ok: age < 15_000,
      workerId: this.workerId,
      uptimeSeconds: uptime,
      memoryMb: memMb,
      lastBeatAgeMs: age
    };
  }

  /**
   * Distributed Lock mechanism for critical singleton tasks (e.g., threat broadcast, cleanup compaction)
   */
  async tryAcquireLock(lockKey: string, ttlMs = 15_000): Promise<boolean> {
    const pool = getPool();
    if (!pool) return true; // Local single-process fallback

    const now = Date.now();
    const expiresAt = now + ttlMs;

    try {
      const res = await query(
        `INSERT INTO worker_locks (lock_key, owner_id, acquired_at, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (lock_key) DO UPDATE SET
           owner_id = EXCLUDED.owner_id,
           acquired_at = EXCLUDED.acquired_at,
           expires_at = EXCLUDED.expires_at
         WHERE worker_locks.expires_at < $3 OR worker_locks.owner_id = EXCLUDED.owner_id
         RETURNING lock_key`,
        [lockKey, this.workerId, now, expiresAt]
      );
      return res.rows.length > 0;
    } catch {
      return false;
    }
  }

  async releaseLock(lockKey: string): Promise<void> {
    const pool = getPool();
    if (!pool) return;

    try {
      await query(
        `DELETE FROM worker_locks WHERE lock_key = $1 AND owner_id = $2`,
        [lockKey, this.workerId]
      );
    } catch {}
  }
}

export const watchdogService = new WatchdogService();
