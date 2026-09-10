import type { AlertRegion } from "../domain/types.js";

export class AlertsInUaSource {
  private activeAlerts = new Map<string, AlertRegion>();
  private lastFetch = 0;
  private readonly apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  async fetchAlerts(): Promise<AlertRegion[]> {
    const now = Date.now();
    // Cache for 15 seconds to respect rate limits
    if (now - this.lastFetch < 15_000 && this.activeAlerts.size > 0) {
      return [...this.activeAlerts.values()];
    }

    // 1. Try official API key if configured
    if (this.apiKey) {
      try {
        const response = await fetch("https://api.alerts.in.ua/v1/alerts/active.json", {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(4500)
        });

        if (response.ok) {
          const data = (await response.json()) as { alerts?: Array<{ location_title: string; location_type: string; finished_at: string | null }> };
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
          this.lastFetch = now;
          return [...this.activeAlerts.values()];
        }
      } catch {
        // Fall through to public feed
      }
    }

    // 2. Live Public Aerial Alerts Feed (reliable, official Ukrainian sirens)
    try {
      const response = await fetch("https://ubilling.net.ua/aerialalerts/", {
        headers: { "User-Agent": "EyeRadar/2.0 (Aviation Safety & Air Defense)" },
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
          this.lastFetch = now;
          return [...this.activeAlerts.values()];
        }
      }
    } catch {
      // Keep cached state on temporary network error
    }

    this.lastFetch = now;
    return [...this.activeAlerts.values()];
  }

  getActiveAlerts(): AlertRegion[] {
    return [...this.activeAlerts.values()];
  }

  getActiveAlertOblastNames(): string[] {
    return [...this.activeAlerts.values()]
      .filter((a) => a.active)
      .map((a) => a.name);
  }
}
