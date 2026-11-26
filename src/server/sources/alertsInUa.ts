import type { AlertRegion } from "../domain/types.js";

const ALERT_STALE_TTL_MS = 3 * 60 * 1000; // 3 minutes without fresh official update = alerts marked stale & cleared

export class AlertsInUaSource {
  private activeAlerts = new Map<string, AlertRegion>();
  private lastAttempt = 0;
  private lastSuccessfulFetch = 0;
  private lastSource = "alerts.in.ua / ubilling";
  private readonly apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  isStale(now = Date.now()): boolean {
    if (this.lastSuccessfulFetch === 0) return false;
    return now - this.lastSuccessfulFetch > ALERT_STALE_TTL_MS;
  }

  getMetadata(now = Date.now()): { source: string; updatedAt: number; stale: boolean } {
    return {
      source: this.lastSource,
      updatedAt: this.lastSuccessfulFetch,
      stale: this.isStale(now)
    };
  }

  async fetchAlerts(now = Date.now()): Promise<AlertRegion[]> {
    // Cache successful fetch for 15 seconds to respect upstream rate limits
    if (this.lastSuccessfulFetch > 0 && now - this.lastSuccessfulFetch < 15_000) {
      return [...this.activeAlerts.values()];
    }
    // Brief retry backoff on transient errors (5s) without masking staleness
    if (this.lastAttempt > 0 && now - this.lastAttempt < 5_000 && this.lastSuccessfulFetch < this.lastAttempt) {
      return this.pruneIfStale(now);
    }
    this.lastAttempt = now;

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
          this.activeAlerts.clear();
          for (const item of data.alerts ?? []) {
            if (!item.finished_at) {
              const id = item.location_title.toLowerCase();
              this.activeAlerts.set(id, {
                id,
                name: item.location_title,
                active: true,
                type: item.location_type === "oblast" ? "oblast" : "raion",
                updatedAt: now
              });
            }
          }
          this.lastSuccessfulFetch = now;
          this.lastSource = "api.alerts.in.ua";
          return [...this.activeAlerts.values()];
        }
      } catch {
        // Fall through to public official mirror
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
        if (data.states) {
          this.activeAlerts.clear();
          for (const [regionName, info] of Object.entries(data.states)) {
            if (info.alertnow) {
              const id = regionName.toLowerCase();
              this.activeAlerts.set(id, {
                id,
                name: regionName,
                active: true,
                type: regionName.includes("область") ? "oblast" : "city",
                updatedAt: now
              });
            }
          }
          this.lastSuccessfulFetch = now;
          this.lastSource = "ubilling.net.ua/aerialalerts";
          return [...this.activeAlerts.values()];
        }
      }
    } catch {
      // Upstream unavailable: retain briefly, expire strictly past ALERT_STALE_TTL_MS
    }

    return this.pruneIfStale(now);
  }

  private pruneIfStale(now: number): AlertRegion[] {
    if (this.lastSuccessfulFetch > 0 && now - this.lastSuccessfulFetch > ALERT_STALE_TTL_MS) {
      this.activeAlerts.clear();
      return [];
    }
    return [...this.activeAlerts.values()];
  }

  getActiveAlerts(now = Date.now()): AlertRegion[] {
    return this.pruneIfStale(now);
  }

  getActiveAlertOblastNames(now = Date.now()): string[] {
    return this.pruneIfStale(now)
      .filter((a) => a.active)
      .map((a) => a.name);
  }
}
