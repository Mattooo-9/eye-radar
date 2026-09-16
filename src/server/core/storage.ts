import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "../config/env.js";
import type { UserAlertPreference } from "../domain/types.js";
import { getPool, query } from "../db/pool.js";

const DATA_DIR = resolve(process.cwd(), "data");
const STORAGE_FILE = resolve(DATA_DIR, "subscriptions.json");
const UPSTASH_KEY = "eye_radar_subscriptions";

export class StorageManager {
  private preferences = new Map<number, UserAlertPreference>();

  constructor() {
    this.init();
    void this.syncFromPostgres();
    void this.syncFromCloud();
  }

  private init(): void {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    if (existsSync(STORAGE_FILE)) {
      try {
        const raw = readFileSync(STORAGE_FILE, "utf8");
        const list = JSON.parse(raw) as UserAlertPreference[];
        for (const item of list) {
          this.preferences.set(item.chatId, item);
        }
      } catch (err) {
        console.warn("Could not read subscriptions storage, starting fresh:", err);
      }
    }
  }

  private async syncFromPostgres(): Promise<void> {
    const pool = getPool();
    if (!pool) return;

    try {
      const res = await query(
        `SELECT chat_id as "chatId", lat, lon, city_name as "cityName", radius_km as "radiusKm",
                enabled, sound_enabled as "soundEnabled", last_alert_state as "lastAlertState",
                last_notified as "lastNotified"
         FROM user_preferences`
      );
      if (res.rows.length > 0) {
        for (const row of res.rows) {
          const pref: UserAlertPreference = {
            chatId: Number(row.chatId),
            lat: Number(row.lat),
            lon: Number(row.lon),
            cityName: row.cityName || undefined,
            radiusKm: Number(row.radiusKm || 30),
            enabled: Boolean(row.enabled),
            soundEnabled: Boolean(row.soundEnabled),
            lastAlertState: row.lastAlertState !== null ? Boolean(row.lastAlertState) : undefined,
            lastNotified: row.lastNotified ? Number(row.lastNotified) : undefined
          };
          this.preferences.set(pref.chatId, pref);
        }
        this.persistLocal();
        console.log(`🐘 Synced ${res.rows.length} user subscriptions from Neon Postgres`);
      }
    } catch (err) {
      console.warn("StorageManager: Postgres sync warning:", err);
    }
  }

  private async syncToPostgres(pref: UserAlertPreference): Promise<void> {
    const pool = getPool();
    if (!pool) return;

    try {
      await query(
        `INSERT INTO user_preferences (chat_id, lat, lon, city_name, radius_km, enabled, sound_enabled, last_alert_state, last_notified, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (chat_id) DO UPDATE SET
           lat = EXCLUDED.lat,
           lon = EXCLUDED.lon,
           city_name = EXCLUDED.city_name,
           radius_km = EXCLUDED.radius_km,
           enabled = EXCLUDED.enabled,
           sound_enabled = EXCLUDED.sound_enabled,
           last_alert_state = EXCLUDED.last_alert_state,
           last_notified = EXCLUDED.last_notified,
           updated_at = EXCLUDED.updated_at`,
        [
          pref.chatId,
          pref.lat,
          pref.lon,
          pref.cityName || null,
          pref.radiusKm ?? 30,
          pref.enabled !== false,
          pref.soundEnabled !== false,
          pref.lastAlertState !== undefined ? pref.lastAlertState : null,
          pref.lastNotified || null,
          Date.now()
        ]
      );
    } catch (err) {
      console.warn("StorageManager: failed to sync preference to Postgres:", err);
    }
  }

  private async deleteFromPostgres(chatId: number): Promise<void> {
    const pool = getPool();
    if (!pool) return;

    try {
      await query(`DELETE FROM user_preferences WHERE chat_id = $1`, [chatId]);
    } catch (err) {
      console.warn("StorageManager: failed to delete preference from Postgres:", err);
    }
  }

  private async syncFromCloud(): Promise<void> {
    if (!env.upstashRedisRestUrl || !env.upstashRedisRestToken) return;

    try {
      const res = await fetch(`${env.upstashRedisRestUrl}/get/${UPSTASH_KEY}`, {
        headers: { Authorization: `Bearer ${env.upstashRedisRestToken}` },
        signal: AbortSignal.timeout(4000)
      });
      if (!res.ok) return;

      const body = (await res.json()) as { result?: string };
      if (body.result) {
        const list = (typeof body.result === "string" ? JSON.parse(body.result) : body.result) as UserAlertPreference[];
        if (Array.isArray(list)) {
          for (const item of list) {
            if (!this.preferences.has(item.chatId)) {
              this.preferences.set(item.chatId, item);
              void this.syncToPostgres(item);
            }
          }
          this.persistLocal();
        }
      }
    } catch (err) {
      console.warn("Upstash Redis sync warning:", err);
    }
  }

  private async syncToCloud(): Promise<void> {
    if (!env.upstashRedisRestUrl || !env.upstashRedisRestToken) return;

    try {
      const data = JSON.stringify([...this.preferences.values()]);
      await fetch(`${env.upstashRedisRestUrl}/set/${UPSTASH_KEY}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.upstashRedisRestToken}`,
          "Content-Type": "application/json"
        },
        body: data,
        signal: AbortSignal.timeout(4000)
      });
    } catch (err) {
      console.warn("Upstash Redis save warning:", err);
    }
  }

  getPreference(chatId: number): UserAlertPreference | undefined {
    return this.preferences.get(chatId);
  }

  getAllPreferences(): UserAlertPreference[] {
    return [...this.preferences.values()];
  }

  savePreference(pref: UserAlertPreference): void {
    this.preferences.set(pref.chatId, pref);
    this.persistLocal();
    void this.syncToPostgres(pref);
    void this.syncToCloud();
  }

  deletePreference(chatId: number): void {
    this.preferences.delete(chatId);
    this.persistLocal();
    void this.deleteFromPostgres(chatId);
    void this.syncToCloud();
  }

  private persistLocal(): void {
    try {
      if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = JSON.stringify([...this.preferences.values()], null, 2);
      const tempFile = `${STORAGE_FILE}.tmp`;
      writeFileSync(tempFile, data, "utf8");
      renameSync(tempFile, STORAGE_FILE);
    } catch (err) {
      console.error("Failed to persist subscriptions locally:", err);
    }
  }
}
