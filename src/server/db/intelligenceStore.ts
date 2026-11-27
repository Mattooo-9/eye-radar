// src/server/db/intelligenceStore.ts
import { getPool, query } from "./pool.js";
import type { TrackState } from "../domain/types.js";

export interface PersistedOsintBulletin {
  postRef: string;
  channel: string;
  text: string;
  publishedAt: number;
  targetType?: string;
  oblast?: string;
  cityName?: string;
  lat?: number;
  lon?: number;
  model?: string;
}

export interface IntelligenceDbStats {
  connected: boolean;
  bulletinsStored: number;
  snapshotsStored: number;
  inMemoryBulletins: number;
  lastPersistAt: number;
}

/**
 * Autonomous PostgreSQL (Neon) + in-memory ring persistence layer for empirical OSINT bulletins
 * and historical track snapshots. Eliminates cold-start blind spots and powers live feed & replay.
 */
export class IntelligenceStore {
  private memoryBulletins = new Map<string, PersistedOsintBulletin>();
  private readonly maxMemoryBulletins = 120;
  private lastPersistAt = 0;
  private lastPruneAt = 0;
  private lastSnapshotAt = 0;

  async saveBulletins(items: PersistedOsintBulletin[]): Promise<void> {
    if (items.length === 0) return;
    const now = Date.now();

    for (const item of items) {
      this.memoryBulletins.set(item.postRef, item);
    }
    if (this.memoryBulletins.size > this.maxMemoryBulletins) {
      const sorted = Array.from(this.memoryBulletins.values())
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, this.maxMemoryBulletins);
      this.memoryBulletins.clear();
      for (const s of sorted) {
        this.memoryBulletins.set(s.postRef, s);
      }
    }

    const pool = getPool();
    if (!pool) return;

    try {
      for (const item of items.slice(0, 40)) {
        await query(
          `INSERT INTO osint_bulletins
            (post_ref, channel, text, published_at, target_type, oblast, city_name, lat, lon, model, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (post_ref) DO UPDATE SET
             target_type = COALESCE(EXCLUDED.target_type, osint_bulletins.target_type),
             oblast = COALESCE(EXCLUDED.oblast, osint_bulletins.oblast),
             city_name = COALESCE(EXCLUDED.city_name, osint_bulletins.city_name),
             lat = COALESCE(EXCLUDED.lat, osint_bulletins.lat),
             lon = COALESCE(EXCLUDED.lon, osint_bulletins.lon),
             model = COALESCE(EXCLUDED.model, osint_bulletins.model)`,
          [
            item.postRef,
            item.channel,
            item.text.slice(0, 1000),
            item.publishedAt,
            item.targetType ?? null,
            item.oblast ?? null,
            item.cityName ?? null,
            item.lat ?? null,
            item.lon ?? null,
            item.model ?? null,
            now
          ]
        );
      }
      this.lastPersistAt = now;
      await this.pruneOldRecordsIfDue(now);
    } catch (err: any) {
      console.warn("⚠️ IntelligenceStore saveBulletins warning:", err?.message || err);
    }
  }

  async loadRecentBulletins(maxAgeMs = 30 * 60 * 1000): Promise<PersistedOsintBulletin[]> {
    const cutoff = Date.now() - maxAgeMs;
    const pool = getPool();
    if (pool) {
      try {
        const res = await query(
          `SELECT post_ref, channel, text, published_at, target_type, oblast, city_name, lat, lon, model
           FROM osint_bulletins
           WHERE published_at >= $1
           ORDER BY published_at DESC
           LIMIT 100`,
          [cutoff]
        );
        const rows: PersistedOsintBulletin[] = res.rows.map((r: any) => ({
          postRef: String(r.post_ref),
          channel: String(r.channel),
          text: String(r.text),
          publishedAt: Number(r.published_at),
          targetType: r.target_type || undefined,
          oblast: r.oblast || undefined,
          cityName: r.city_name || undefined,
          lat: typeof r.lat === "number" ? r.lat : undefined,
          lon: typeof r.lon === "number" ? r.lon : undefined,
          model: r.model || undefined
        }));
        for (const row of rows) {
          this.memoryBulletins.set(row.postRef, row);
        }
        return rows;
      } catch (err: any) {
        console.warn("⚠️ IntelligenceStore loadRecentBulletins warning:", err?.message || err);
      }
    }

    return Array.from(this.memoryBulletins.values())
      .filter((b) => b.publishedAt >= cutoff)
      .sort((a, b) => b.publishedAt - a.publishedAt);
  }

  getLatestFeedItems(limit = 25): PersistedOsintBulletin[] {
    return Array.from(this.memoryBulletins.values())
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, limit);
  }

  clearMemoryBulletins(): void {
    this.memoryBulletins.clear();
  }

  async recordTrackSnapshot(tracks: TrackState[], now = Date.now()): Promise<void> {
    if (now - this.lastSnapshotAt < 30_000) return;
    const realTracks = tracks.filter((t) => !t.isSynthetic);
    if (realTracks.length === 0) return;

    this.lastSnapshotAt = now;
    const pool = getPool();
    if (!pool) return;

    try {
      const compact = realTracks.map((t) => ({
        id: t.id,
        type: t.type,
        lat: t.lat,
        lon: t.lon,
        heading: t.heading,
        speed: t.speed,
        altitude: t.altitude,
        model: t.model,
        callsign: t.callsign,
        confidence: t.confidence,
        timestamp: t.timestamp
      }));
      await query(
        `INSERT INTO track_history_snapshots (recorded_at, tracks_count, tracks_json)
         VALUES ($1, $2, $3)`,
        [now, compact.length, JSON.stringify(compact)]
      );
      await this.pruneOldRecordsIfDue(now);
    } catch (err: any) {
      console.warn("⚠️ IntelligenceStore recordTrackSnapshot warning:", err?.message || err);
    }
  }

  async getHistoricalSnapshotNear(targetTimestamp: number): Promise<any[] | null> {
    const pool = getPool();
    if (!pool) return null;
    try {
      const res = await query(
        `SELECT tracks_json, recorded_at
         FROM track_history_snapshots
         WHERE recorded_at BETWEEN $1 AND $2
         ORDER BY ABS(recorded_at - $3) ASC
         LIMIT 1`,
        [targetTimestamp - 120_000, targetTimestamp + 120_000, targetTimestamp]
      );
      if (res.rows.length > 0 && Array.isArray(res.rows[0].tracks_json)) {
        return res.rows[0].tracks_json;
      }
    } catch {
      // Fallback to in-memory history
    }
    return null;
  }

  async getStats(): Promise<IntelligenceDbStats> {
    const pool = getPool();
    if (!pool) {
      return {
        connected: false,
        bulletinsStored: 0,
        snapshotsStored: 0,
        inMemoryBulletins: this.memoryBulletins.size,
        lastPersistAt: this.lastPersistAt
      };
    }

    try {
      const [bRes, sRes] = await Promise.all([
        query(`SELECT COUNT(*)::int AS cnt FROM osint_bulletins`),
        query(`SELECT COUNT(*)::int AS cnt FROM track_history_snapshots`)
      ]);
      return {
        connected: true,
        bulletinsStored: Number(bRes.rows[0]?.cnt ?? 0),
        snapshotsStored: Number(sRes.rows[0]?.cnt ?? 0),
        inMemoryBulletins: this.memoryBulletins.size,
        lastPersistAt: this.lastPersistAt
      };
    } catch {
      return {
        connected: false,
        bulletinsStored: 0,
        snapshotsStored: 0,
        inMemoryBulletins: this.memoryBulletins.size,
        lastPersistAt: this.lastPersistAt
      };
    }
  }

  private async pruneOldRecordsIfDue(now: number): Promise<void> {
    if (now - this.lastPruneAt < 10 * 60 * 1000) return;
    this.lastPruneAt = now;
    const pool = getPool();
    if (!pool) return;
    try {
      await Promise.all([
        query(`DELETE FROM osint_bulletins WHERE published_at < $1`, [now - 24 * 60 * 60 * 1000]),
        query(`DELETE FROM track_history_snapshots WHERE recorded_at < $1`, [now - 2 * 60 * 60 * 1000])
      ]);
    } catch {
      // Autonomous retention cleanup is best-effort
    }
  }
}

export const intelligenceStore = new IntelligenceStore();
