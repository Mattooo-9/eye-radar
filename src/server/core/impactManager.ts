import type { ImpactEvent, TrackType } from "../domain/types.js";

export class ImpactManager {
  private events: ImpactEvent[] = [];
  private readonly maxEvents = 8;
  private readonly retentionMs = 5 * 60 * 1000; // 5 minutes live display window

  recordEvent(event: ImpactEvent): void {
    // Avoid dropping duplicate badges directly on top of recent nearby events
    const isDuplicate = this.events.some(
      (e) =>
        Math.hypot(e.lat - event.lat, e.lon - event.lon) < 0.12 &&
        Math.abs(e.timestamp - event.timestamp) < 5 * 60 * 1000
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

  getRecentEvents(maxAgeMs = this.retentionMs): ImpactEvent[] {
    const cutoff = Date.now() - maxAgeMs;
    this.events = this.events.filter((e) => e.timestamp >= cutoff);
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

export const impactManager = new ImpactManager();
