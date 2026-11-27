import type { AlertFeedMetadata, AlertFeedStatus, AlertRegion } from "../domain/types.js";

/**
 * After 3 minutes without a fresh confirmed response from an official alert source,
 * the feed transitions to status="stale" (unknown current state — NEVER an all-clear!).
 * The last confirmed alert set and its timestamp are strictly preserved until a new
 * official response supersedes them.
 */
export const ALERT_STALE_TTL_MS = 3 * 60 * 1000;

export class AlertsInUaSource {
  private lastConfirmedAlerts = new Map<string, AlertRegion>();
  private lastAttemptAt = 0;
  private lastConfirmedAt = 0;
  private lastSource = "alerts.in.ua / ubilling";
  private consecutiveFailures = 0;
  private lastError: string | null = null;
  private readonly apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  getStatus(now = Date.now()): AlertFeedStatus {
    if (this.lastConfirmedAt === 0) return "unavailable";
    if (now - this.lastConfirmedAt > ALERT_STALE_TTL_MS) return "stale";
    return "fresh";
  }

  isStale(now = Date.now()): boolean {
    return this.getStatus(now) !== "fresh";
  }

  getMetadata(now = Date.now()): AlertFeedMetadata {
    const status = this.getStatus(now);
    return {
      status,
      source: this.lastSource,
      sourceAvailable: this.lastConfirmedAt > 0 && this.consecutiveFailures === 0,
      stale: status !== "fresh",
      lastConfirmedAt: this.lastConfirmedAt > 0 ? this.lastConfirmedAt : null,
      updatedAt: this.lastConfirmedAt,
      lastAttemptAt: this.lastAttemptAt > 0 ? this.lastAttemptAt : null,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError
    };
  }

  async fetchAlerts(now = Date.now()): Promise<AlertRegion[]> {
    // Cache confirmed response for 15 seconds to respect upstream rate limits
    if (this.lastConfirmedAt > 0 && now - this.lastConfirmedAt < 15_000) {
      return [...this.lastConfirmedAlerts.values()];
    }
    // Brief retry backoff on transient errors (5s) without clearing last confirmed state
    if (this.lastAttemptAt > 0 && now - this.lastAttemptAt < 5_000 && this.lastConfirmedAt < this.lastAttemptAt) {
      return [...this.lastConfirmedAlerts.values()];
    }
    this.lastAttemptAt = now;

    const errors: string[] = [];

    // 1. Try official API key if configured
    if (this.apiKey) {
      try {
        const response = await fetch("https://api.alerts.in.ua/v1/alerts/active.json", {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(4500)
        });

        if (response.ok) {
          const data = (await response.json()) as {
            alerts?: Array<{ location_title: string; location_type: string; finished_at: string | null }>;
          };
          const next = new Map<string, AlertRegion>();
          for (const item of data.alerts ?? []) {
            if (!item.finished_at) {
              const id = item.location_title.toLowerCase();
              next.set(id, {
                id,
                name: item.location_title,
                active: true,
                type: item.location_type === "oblast" ? "oblast" : "raion",
                updatedAt: now
              });
            }
          }
          this.lastConfirmedAlerts = next;
          this.lastConfirmedAt = now;
          this.lastSource = "api.alerts.in.ua";
          this.consecutiveFailures = 0;
          this.lastError = null;
          return [...this.lastConfirmedAlerts.values()];
        }
        errors.push(`alerts.in.ua HTTP ${response.status}`);
      } catch (err) {
        errors.push(`alerts.in.ua ${err instanceof Error ? err.message : "network error"}`);
      }
    }

    // 2. Live Public Aerial Alerts Feed (official Ukrainian siren state mirror)
    try {
      const response = await fetch("https://ubilling.net.ua/aerialalerts/", {
        headers: { "User-Agent": "EyeRadar/2.0 (Civil Airspace Awareness)" },
        signal: AbortSignal.timeout(4500)
      });
      if (response.ok) {
        const data = (await response.json()) as { states?: Record<string, { alertnow: boolean; changed?: string }> };
        if (data.states && typeof data.states === "object") {
          const next = new Map<string, AlertRegion>();
          for (const [regionName, info] of Object.entries(data.states)) {
            if (info.alertnow) {
              const id = regionName.toLowerCase();
              next.set(id, {
                id,
                name: regionName,
                active: true,
                type: regionName.includes("область") ? "oblast" : "city",
                updatedAt: now
              });
            }
          }
          this.lastConfirmedAlerts = next;
          this.lastConfirmedAt = now;
          this.lastSource = "ubilling.net.ua/aerialalerts";
          this.consecutiveFailures = 0;
          this.lastError = null;
          return [...this.lastConfirmedAlerts.values()];
        }
        errors.push("ubilling invalid payload");
      } else {
        errors.push(`ubilling HTTP ${response.status}`);
      }
    } catch (err) {
      errors.push(`ubilling ${err instanceof Error ? err.message : "network error"}`);
    }

    // Upstream failure: NEVER wipe lastConfirmedAlerts (loss of connection != all-clear!).
    // Preserve last confirmed state & timestamp; getMetadata(now) explicitly surfaces status="stale"|"unavailable".
    this.consecutiveFailures += 1;
    this.lastError = errors.join("; ") || "Official alert source unreachable";
    return [...this.lastConfirmedAlerts.values()];
  }

  getActiveAlerts(): AlertRegion[] {
    return [...this.lastConfirmedAlerts.values()];
  }

  getActiveAlertOblastNames(): string[] {
    return [...this.lastConfirmedAlerts.values()]
      .filter((a) => a.active)
      .map((a) => a.name);
  }
}
