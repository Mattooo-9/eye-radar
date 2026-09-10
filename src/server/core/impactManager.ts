import type { ImpactEvent, TrackType } from "../domain/types.js";

export class ImpactManager {
  private events: ImpactEvent[] = [];
  private readonly maxEvents = 50;
  private readonly retentionMs = 6 * 3600 * 1000; // 6 hours

  recordEvent(event: ImpactEvent): void {
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
