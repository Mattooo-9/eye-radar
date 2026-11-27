// src/server/core/lifecyclePolicy.ts
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { getPool, query } from "../db/pool.js";
import { createLogger } from "../observability/logger.js";

const log = createLogger("lifecycle-policy");

/**
 * Single Centralized Information Lifecycle & Retention Policy.
 * Replaces scattered ad-hoc timers with one canonical specification across
 * Telegram bot messages, active map state, Neon PostgreSQL tables, and local storage.
 */
export const RETENTION_POLICY = {
  // 1. Telegram Bot Message Lifecycle
  BOT_STANDARD_NOTIFICATION_TTL_MS: 6 * 60 * 60 * 1000,        // 6 hours for standard notifications
  BOT_ACTIVE_WARNING_SAFETY_TTL_MS: 47 * 60 * 60 * 1000,       // 47h safety bound (Telegram API hard limit is 48h) while held until all-clear
  BOT_POST_ALL_CLEAR_TTL_MS: 30 * 60 * 1000,                   // 30 minutes after official all-clear ("відбій")
  BOT_EPHEMERAL_REPLY_TTL_MS: 15 * 60 * 1000,                  // 15 minutes for temporary service replies (/status, /report ack)
  BOT_TEST_TTL_MS: 60 * 1000,                                  // 60 seconds diagnostic test TTL
  BOT_MAX_RETRY_COUNT: 5,

  // 2. Active Map & Real-Time Feed Freshness
  MAP_OBSERVATION_MAX_AGE_MS: 25 * 1000,                       // 25s ingest gate
  MAP_TRACK_STALE_PRUNE_MS: 45 * 1000,                         // 45s active track expiry
  MAP_CITIZEN_REPORT_TTL_MS: 5 * 60 * 1000,                    // 5 min unverified eyewitness expiry
  OFFICIAL_ALERT_SOURCE_STALE_MS: 3 * 60 * 1000,               // 3 min without source response -> status="stale" (unknown, NEVER all-clear)

  // 3. Neon PostgreSQL Retention Rules
  DB_TEMP_RECORDS_RETENTION_MS: 24 * 60 * 60 * 1000,           // 24 hours: osint_bulletins, radar_events, completed deletion queue jobs
  DB_TRACK_SNAPSHOTS_RETENTION_MS: 2 * 60 * 60 * 1000,         // 2 hours: high-frequency track_history_snapshots
  DB_DIAGNOSTIC_LOGS_RETENTION_MS: 7 * 24 * 60 * 60 * 1000,    // 7 days: diagnostic_logs & stale worker_watchdog rows
  DB_OFFICIAL_ALERT_HISTORY_RETENTION_MS: 30 * 24 * 60 * 60 * 1000, // 30 days: anonymized official_alert_history
  DB_INACTIVE_USER_PREF_RETENTION_MS: 30 * 24 * 60 * 60 * 1000,// 30 days: disabled/inactive user_preferences (privacy minimization)
  DB_CHECKPOINT_KEEP_COUNT: 3,                                 // Keep only 'latest' + up to 2 recent backup checkpoints

  // 4. Local Filesystem & Memory Hygiene
  LOCAL_TMP_FILE_MAX_AGE_MS: 6 * 60 * 60 * 1000,               // 6 hours for orphaned .tmp files
  CLEANUP_SWEEP_INTERVAL_MS: 5 * 60 * 1000                     // Run full DB/system hygiene sweep every 5 minutes
} as const;

export interface OfficialAlertHistoryEntry {
  id?: number;
  oblast: string;
  eventType: "alert_start" | "alert_clear";
  source: string;
  recordedAt: number;
}

export interface LifecycleSweepStats {
  lastSweepAt: number | null;
  sweepsRun: number;
  deletedTempRecords: number;
  deletedDiagnosticLogs: number;
  deletedAlertHistory: number;
  deletedStaleCheckpoints: number;
  deletedInactivePrefs: number;
  deletedCompletedQueueJobs: number;
  cleanedTempFiles: number;
  tableCounts: {
    osintBulletins: number;
    trackSnapshots: number;
    radarEvents: number;
    deletionQueuePending: number;
    deletionQueueTotal: number;
    officialAlertHistory: number;
    diagnosticLogs: number;
    userPreferences: number;
  };
}

export class LifecycleCleanupService {
  private lastSweepAt: number | null = null;
  private sweepsRun = 0;
  private isSweeping = false;
  private recentAlertHistory: OfficialAlertHistoryEntry[] = [];
  private readonly maxInMemoryAlertHistory = 60;
  private lastStats: LifecycleSweepStats = {
    lastSweepAt: null,
    sweepsRun: 0,
    deletedTempRecords: 0,
    deletedDiagnosticLogs: 0,
    deletedAlertHistory: 0,
    deletedStaleCheckpoints: 0,
    deletedInactivePrefs: 0,
    deletedCompletedQueueJobs: 0,
    cleanedTempFiles: 0,
    tableCounts: {
      osintBulletins: 0,
      trackSnapshots: 0,
      radarEvents: 0,
      deletionQueuePending: 0,
      deletionQueueTotal: 0,
      officialAlertHistory: 0,
      diagnosticLogs: 0,
      userPreferences: 0
    }
  };

  /**
   * Records an anonymized official civil alert transition (start or all-clear).
   * Contains ZERO personal/user data; retained for up to 30 days.
   */
  async recordOfficialAlertTransition(entry: OfficialAlertHistoryEntry): Promise<void> {
    this.recentAlertHistory.unshift(entry);
    if (this.recentAlertHistory.length > this.maxInMemoryAlertHistory) {
      this.recentAlertHistory.length = this.maxInMemoryAlertHistory;
    }

    const pool = getPool();
    if (!pool) return;

    try {
      await query(
        `INSERT INTO official_alert_history (oblast, event_type, source, recorded_at)
         VALUES ($1, $2, $3, $4)`,
        [entry.oblast.slice(0, 120), entry.eventType, entry.source.slice(0, 64), entry.recordedAt]
      );
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "Could not persist official alert transition");
    }
  }

  /**
   * Records a technical diagnostic log entry in Neon Postgres (retained up to 7 days).
   */
  async recordDiagnosticLog(level: "WARN" | "ERROR" | "CRITICAL", component: string, message: string, meta?: Record<string, unknown>): Promise<void> {
    const pool = getPool();
    if (!pool) return;
    try {
      await query(
        `INSERT INTO diagnostic_logs (level, component, message, meta_json, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [level, component.slice(0, 64), message.slice(0, 500), JSON.stringify(meta ?? {}), Date.now()]
      );
    } catch {}
  }

  async getOfficialAlertHistory(limit = 30): Promise<OfficialAlertHistoryEntry[]> {
    const clamped = Math.min(100, Math.max(1, limit));
    const pool = getPool();
    if (pool) {
      try {
        const res = await query(
          `SELECT id, oblast, event_type as "eventType", source, recorded_at as "recordedAt"
           FROM official_alert_history
           ORDER BY recorded_at DESC
           LIMIT $1`,
          [clamped]
        );
        if (res.rows.length > 0) {
          return res.rows.map((r: any) => ({
            id: Number(r.id),
            oblast: String(r.oblast),
            eventType: r.eventType === "alert_clear" ? "alert_clear" : "alert_start",
            source: String(r.source),
            recordedAt: Number(r.recordedAt)
          }));
        }
      } catch {}
    }
    return this.recentAlertHistory.slice(0, clamped);
  }

  /**
   * Executes the centralized database & filesystem self-cleaning sweep according to RETENTION_POLICY.
   * Isolated try/catch blocks ensure failure in any single step never interrupts the system.
   */
  async runCleanupSweep(now = Date.now()): Promise<LifecycleSweepStats> {
    if (this.isSweeping) return this.lastStats;
    this.isSweeping = true;

    let deletedTempRecords = 0;
    let deletedDiagnosticLogs = 0;
    let deletedAlertHistory = 0;
    let deletedStaleCheckpoints = 0;
    let deletedInactivePrefs = 0;
    let deletedCompletedQueueJobs = 0;
    let cleanedTempFiles = 0;

    try {
      // 1. Clean orphaned local .tmp files in data/ and /tmp
      cleanedTempFiles = this.cleanOrphanedLocalTempFiles(now);

      const pool = getPool();
      if (pool) {
        const cutoff24h = now - RETENTION_POLICY.DB_TEMP_RECORDS_RETENTION_MS;
        const cutoff2h = now - RETENTION_POLICY.DB_TRACK_SNAPSHOTS_RETENTION_MS;
        const cutoff7d = now - RETENTION_POLICY.DB_DIAGNOSTIC_LOGS_RETENTION_MS;
        const cutoff30d = now - RETENTION_POLICY.DB_OFFICIAL_ALERT_HISTORY_RETENTION_MS;
        const cutoffPrefs = now - RETENTION_POLICY.DB_INACTIVE_USER_PREF_RETENTION_MS;

        // 2. Temporary technical records (<= 24h) & high-frequency snapshots (<= 2h) & duplicate OSINT bulletins
        try {
          const r1 = await query(`DELETE FROM osint_bulletins WHERE published_at < $1`, [cutoff24h]);
          const r2 = await query(`DELETE FROM track_history_snapshots WHERE recorded_at < $1`, [cutoff2h]);
          const r3 = await query(`DELETE FROM radar_events WHERE created_at < $1`, [cutoff24h]);
          const r4 = await query(`DELETE FROM worker_locks WHERE expires_at < $1`, [now]);
          deletedTempRecords = (r1.rowCount ?? 0) + (r2.rowCount ?? 0) + (r3.rowCount ?? 0) + (r4.rowCount ?? 0);
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, "Temp records cleanup warning");
        }

        // 3. Completed/failed Telegram message deletion jobs (> 24h) & expired pending jobs (> 48h Telegram limit)
        try {
          const cutoff48h = now - 48 * 60 * 60 * 1000;
          await query(
            `UPDATE bot_message_deletion_queue
             SET status = 'completed', last_error = 'expired_telegram_48h_window'
             WHERE status = 'pending' AND created_at < $1`,
            [cutoff48h]
          );
          const rq = await query(
            `DELETE FROM bot_message_deletion_queue
             WHERE (status IN ('completed', 'failed') AND created_at < $1)
                OR created_at < $2`,
            [cutoff24h, cutoff7d]
          );
          deletedCompletedQueueJobs = rq.rowCount ?? 0;
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, "Deletion queue cleanup warning");
        }

        // 4. Diagnostic logs & stale worker watchdog entries (<= 7 days)
        try {
          const rd1 = await query(`DELETE FROM diagnostic_logs WHERE created_at < $1`, [cutoff7d]);
          const rd2 = await query(`DELETE FROM worker_watchdog WHERE last_heartbeat_at < $1`, [cutoff7d]);
          deletedDiagnosticLogs = (rd1.rowCount ?? 0) + (rd2.rowCount ?? 0);
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, "Diagnostic logs cleanup warning");
        }

        // 5. Anonymized official alert history (<= 30 days)
        try {
          const ra = await query(`DELETE FROM official_alert_history WHERE recorded_at < $1`, [cutoff30d]);
          deletedAlertHistory = ra.rowCount ?? 0;
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, "Alert history cleanup warning");
        }

        // 6. Redundant checkpoints (always keep 'latest' + up to 2 most recent)
        try {
          const rc = await query(
            `DELETE FROM radar_checkpoints
             WHERE checkpoint_id <> 'latest'
               AND checkpoint_id NOT IN (
                 SELECT checkpoint_id FROM radar_checkpoints
                 ORDER BY sequence_id DESC
                 LIMIT $1
               )`,
            [RETENTION_POLICY.DB_CHECKPOINT_KEEP_COUNT]
          );
          deletedStaleCheckpoints = rc.rowCount ?? 0;
        } catch {}

        // 7. Personal data minimization: purge disabled/abandoned user_preferences older than 30d
        try {
          const rp = await query(
            `DELETE FROM user_preferences
             WHERE enabled = false AND updated_at < $1`,
            [cutoffPrefs]
          );
          deletedInactivePrefs = rp.rowCount ?? 0;
        } catch {}

        // 8. Refresh table row counts for observability
        try {
          const countsRes = await query(`
            SELECT
              (SELECT COUNT(*)::int FROM osint_bulletins) AS osint_bulletins,
              (SELECT COUNT(*)::int FROM track_history_snapshots) AS track_snapshots,
              (SELECT COUNT(*)::int FROM radar_events) AS radar_events,
              (SELECT COUNT(*)::int FROM bot_message_deletion_queue WHERE status = 'pending') AS queue_pending,
              (SELECT COUNT(*)::int FROM bot_message_deletion_queue) AS queue_total,
              (SELECT COUNT(*)::int FROM official_alert_history) AS alert_history,
              (SELECT COUNT(*)::int FROM diagnostic_logs) AS diagnostic_logs,
              (SELECT COUNT(*)::int FROM user_preferences) AS user_preferences
          `);
          const row = countsRes.rows[0] || {};
          this.lastStats.tableCounts = {
            osintBulletins: Number(row.osint_bulletins ?? 0),
            trackSnapshots: Number(row.track_snapshots ?? 0),
            radarEvents: Number(row.radar_events ?? 0),
            deletionQueuePending: Number(row.queue_pending ?? 0),
            deletionQueueTotal: Number(row.queue_total ?? 0),
            officialAlertHistory: Number(row.alert_history ?? 0),
            diagnosticLogs: Number(row.diagnostic_logs ?? 0),
            userPreferences: Number(row.user_preferences ?? 0)
          };
        } catch {}
      }

      this.lastSweepAt = now;
      this.sweepsRun += 1;
      this.lastStats = {
        ...this.lastStats,
        lastSweepAt: now,
        sweepsRun: this.sweepsRun,
        deletedTempRecords,
        deletedDiagnosticLogs,
        deletedAlertHistory,
        deletedStaleCheckpoints,
        deletedInactivePrefs,
        deletedCompletedQueueJobs,
        cleanedTempFiles
      };
    } finally {
      this.isSweeping = false;
    }

    return this.lastStats;
  }

  cleanOrphanedLocalTempFiles(now = Date.now()): number {
    let cleaned = 0;
    const dirs = [resolve(process.cwd(), "data")];
    if (process.env.VERCEL) dirs.push("/tmp");

    for (const dir of dirs) {
      try {
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) {
          if (!name.endsWith(".tmp") && !name.endsWith(".bak") && !name.endsWith(".old")) continue;
          const full = join(dir, name);
          try {
            const st = statSync(full);
            if (now - st.mtimeMs > RETENTION_POLICY.LOCAL_TMP_FILE_MAX_AGE_MS) {
              unlinkSync(full);
              cleaned += 1;
            }
          } catch {}
        }
      } catch {}
    }
    return cleaned;
  }

  getStats(): LifecycleSweepStats {
    return this.lastStats;
  }
}

export const lifecycleCleanupService = new LifecycleCleanupService();
