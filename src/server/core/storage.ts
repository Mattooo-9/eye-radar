import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "../config/env.js";
import type { UserAlertPreference } from "../domain/types.js";

const DATA_DIR = resolve(process.cwd(), "data");
const STORAGE_FILE = resolve(DATA_DIR, "subscriptions.json");
const UPSTASH_KEY = "eye_radar_subscriptions";

export class StorageManager {
  private preferences = new Map<number, UserAlertPreference>();

  constructor() {
    this.init();
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
            this.preferences.set(item.chatId, item);
          }
          this.persistLocal();
          console.log(`☁️ Synced ${list.length} user subscriptions from Upstash Redis`);
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
    void this.syncToCloud();
  }

  deletePreference(chatId: number): void {
    this.preferences.delete(chatId);
    this.persistLocal();
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
