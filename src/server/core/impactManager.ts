import type { ImpactEvent, TrackType } from "../domain/types.js";

export const IMPACT_TTL_MS = 60 * 60 * 1000;      // 60 minutes for impacts / explosions
export const INTERCEPT_TTL_MS = 10 * 60 * 1000;   // 10 minutes for interceptions / shootdowns

export class ImpactManager {
  private events: ImpactEvent[] = [];
  private readonly maxEvents = 60;

  recordEvent(event: ImpactEvent): void {
    // Avoid dropping duplicate badges directly on top of recent nearby events within 2 minutes
    const isDuplicate = this.events.some(
      (e) =>
        Math.hypot(e.lat - event.lat, e.lon - event.lon) < 0.05 &&
        Math.abs(e.timestamp - event.timestamp) < 2 * 60 * 1000 &&
        e.type === event.type
    );
    if (isDuplicate) return;

    this.events.unshift(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(0, this.maxEvents);
    }
  }

  createAndRecord(
    type: "impact" | "intercept",
    lat: number,
    lon: number,
    targetModel: string,
    targetType: TrackType,
    region: string,
    details?: string
  ): ImpactEvent {
    const event: ImpactEvent = {
      id: `evt-${type}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      type,
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      timestamp: Date.now(),
      targetModel,
      targetType,
      region,
      details
    };
    this.recordEvent(event);
    return event;
  }

  getRecentEvents(now = Date.now()): ImpactEvent[] {
    this.events = this.events.filter((e) => {
      const ttl = e.type === "impact" ? IMPACT_TTL_MS : INTERCEPT_TTL_MS;
      return now - e.timestamp <= ttl;
    });
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

export const impactManager = new ImpactManager();
