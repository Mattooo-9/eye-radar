// src/server/db/checkpointService.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getPool, query } from "./pool.js";
import type { TrackState } from "../domain/types.js";

export interface RadarCheckpoint {
  checkpointId: string;
  sequenceId: number;
  tracksCount: number;
  tracks: TrackState[];
  timestamp: number;
}

export interface RadarEventRecord {
  eventId: string;
  trackId: string;
  sequenceId: number;
  eventType: string;
  payload: any;
  createdAt: number;
}

export class CheckpointService {
  private readonly localBackupPath: string;
  private inMemoryEvents: RadarEventRecord[] = [];
  private readonly maxInMemoryEvents = 500;
  private lastSavedSeq = 0;

  constructor(customBackupPath?: string) {
    this.localBackupPath = customBackupPath || resolve(process.cwd(), "data", "latest_checkpoint.json");
  }

  /**
   * Persists an atomic checkpoint of the current sequence and active Kalman tracks.
   * Neon Postgres is the primary target, with atomic local file write for zero-loss offline resiliency.
   */
  async saveCheckpoint(
    sequenceId: number,
    tracks: TrackState[],
    timestamp = Date.now()
  ): Promise<boolean> {
    this.lastSavedSeq = sequenceId;

    // 1. Atomic local file backup
    try {
      const dir = dirname(this.localBackupPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const serializedTracks = JSON.stringify(tracks, (key, val) => {
        if (key === "sources" && val instanceof Set) {
          return Array.from(val);
        }
        return val;
      });
      const data = JSON.stringify({
        checkpointId: "latest",
        sequenceId,
        tracksCount: tracks.length,
        tracks: JSON.parse(serializedTracks),
        timestamp
      });
      const tmp = `${this.localBackupPath}.tmp`;
      writeFileSync(tmp, data, "utf8");
      renameSync(tmp, this.localBackupPath);
    } catch (err) {
      console.warn("CheckpointService: local file save warning:", err);
    }

    // 2. Neon Postgres primary store
    const pool = getPool();
    if (pool) {
      try {
        const serializedTracks = JSON.stringify(tracks, (key, val) => {
          if (key === "sources" && val instanceof Set) {
            return Array.from(val);
          }
          return val;
        });
        await query(
          `INSERT INTO radar_checkpoints (checkpoint_id, sequence_id, tracks_count, tracks_state, timestamp, created_at)
           VALUES ('latest', $1, $2, $3, $4, NOW())
           ON CONFLICT (checkpoint_id) DO UPDATE SET
             sequence_id = EXCLUDED.sequence_id,
             tracks_count = EXCLUDED.tracks_count,
             tracks_state = EXCLUDED.tracks_state,
             timestamp = EXCLUDED.timestamp,
             created_at = NOW()`,
          [sequenceId, tracks.length, serializedTracks, timestamp]
        );
        return true;
      } catch (err: any) {
        console.warn("CheckpointService: Postgres save warning:", err?.message || err);
      }
    }

    return false;
  }

  /**
   * Loads the latest checkpoint on worker boot to seamlessly resume tracking and sequence numbering.
   */
  async loadLatestCheckpoint(): Promise<RadarCheckpoint | null> {
    const parseTracks = (raw: any): TrackState[] => {
      const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!Array.isArray(arr)) return [];
      return arr.map((t: any) => ({
        ...t,
        sources: Array.isArray(t.sources) ? new Set(t.sources) : (t.sources instanceof Set ? t.sources : new Set(["osint"]))
      }));
    };

    const pool = getPool();
    if (pool) {
      try {
        const res = await query(
          `SELECT checkpoint_id as "checkpointId", sequence_id as "sequenceId", tracks_count as "tracksCount", tracks_state as "tracksState", timestamp
           FROM radar_checkpoints
           WHERE checkpoint_id = 'latest'
           LIMIT 1`
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          const tracks = parseTracks(row.tracksState);
          console.log(`📦 Restored checkpoint from Postgres: sequence ${row.sequenceId}, ${row.tracksCount} tracks`);
          return {
            checkpointId: row.checkpointId,
            sequenceId: Number(row.sequenceId),
            tracksCount: Number(row.tracksCount),
            tracks,
            timestamp: Number(row.timestamp)
          };
        }
      } catch (err: any) {
        console.warn("CheckpointService: Postgres load warning, falling back to local file:", err?.message || err);
      }
    }

    // Local file fallback
    try {
      if (existsSync(this.localBackupPath)) {
        const raw = readFileSync(this.localBackupPath, "utf8");
        const parsed = JSON.parse(raw);
        console.log(`📦 Restored checkpoint from local file: sequence ${parsed.sequenceId}, ${parsed.tracksCount} tracks`);
        return {
          checkpointId: parsed.checkpointId,
          sequenceId: Number(parsed.sequenceId),
          tracksCount: Number(parsed.tracksCount),
          tracks: parseTracks(parsed.tracks),
          timestamp: Number(parsed.timestamp)
        };
      }
    } catch (err) {
      console.warn("CheckpointService: local file load warning:", err);
    }

    return null;
  }

  /**
   * Appends an idempotent event log entry (track update, alert, impact).
   */
  async appendEvent(event: {
    eventId: string;
    trackId: string;
    sequenceId: number;
    eventType: string;
    payload: any;
    createdAt?: number;
  }): Promise<void> {
    const now = event.createdAt || Date.now();
    const record: RadarEventRecord = {
      eventId: event.eventId,
      trackId: event.trackId,
      sequenceId: event.sequenceId,
      eventType: event.eventType,
      payload: event.payload,
      createdAt: now
    };

    // Keep bounded in-memory buffer for fast WebSocket reconciliation
    this.inMemoryEvents.push(record);
    if (this.inMemoryEvents.length > this.maxInMemoryEvents) {
      this.inMemoryEvents.shift();
    }

    const pool = getPool();
    if (pool) {
      try {
        await query(
          `INSERT INTO radar_events (event_id, track_id, sequence_id, event_type, payload, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (event_id) DO NOTHING`,
          [event.eventId, event.trackId, event.sequenceId, event.eventType, JSON.stringify(event.payload), now]
        );
      } catch (err: any) {
        // Non-blocking event log error
      }
    }
  }

  /**
   * Retrieves events since a given sequence ID for WebSocket client reconciliation.
   */
  async getEventsSince(lastSeq: number, limit = 100): Promise<RadarEventRecord[]> {
    // 1. Check in-memory ring buffer first (< 0.1ms)
    const inMem = this.inMemoryEvents.filter((e) => e.sequenceId > lastSeq);
    if (inMem.length > 0 && inMem[0].sequenceId === lastSeq + 1) {
      return inMem.slice(0, limit);
    }

    // 2. Query Postgres if gap is outside in-memory window
    const pool = getPool();
    if (pool) {
      try {
        const res = await query(
          `SELECT event_id as "eventId", track_id as "trackId", sequence_id as "sequenceId", event_type as "eventType", payload, created_at as "createdAt"
           FROM radar_events
           WHERE sequence_id > $1
           ORDER BY sequence_id ASC
           LIMIT $2`,
          [lastSeq, limit]
        );
        return res.rows.map((r) => ({
          ...r,
          sequenceId: Number(r.sequenceId),
          createdAt: Number(r.createdAt),
          payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload
        }));
      } catch (err) {
        console.warn("Failed to query events since sequence:", err);
      }
    }

    return [];
  }
}

export const checkpointService = new CheckpointService();
