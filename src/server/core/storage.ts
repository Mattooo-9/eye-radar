import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { UserAlertPreference } from "../domain/types.js";

const DATA_DIR = resolve(process.cwd(), "data");
const STORAGE_FILE = resolve(DATA_DIR, "subscriptions.json");

export class StorageManager {
  private preferences = new Map<number, UserAlertPreference>();

  constructor() {
    this.init();
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

  getPreference(chatId: number): UserAlertPreference | undefined {
    return this.preferences.get(chatId);
  }

  getAllPreferences(): UserAlertPreference[] {
    return [...this.preferences.values()];
  }

  savePreference(pref: UserAlertPreference): void {
    this.preferences.set(pref.chatId, pref);
    this.persist();
  }

  deletePreference(chatId: number): void {
    this.preferences.delete(chatId);
    this.persist();
  }

  private persist(): void {
    try {
      if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = JSON.stringify([...this.preferences.values()], null, 2);
      const tempFile = `${STORAGE_FILE}.tmp`;
      writeFileSync(tempFile, data, "utf8");
      renameSync(tempFile, STORAGE_FILE);
    } catch (err) {
      console.error("Failed to persist subscriptions:", err);
    }
  }
}
