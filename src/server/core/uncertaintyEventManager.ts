// src/server/core/uncertaintyEventManager.ts
import type { UncertaintyEvent, UncertaintySourceFamily } from "../domain/uncertaintyEvent.js";
import { haversineMeters } from "../domain/geo.js";
import type { Observation } from "../domain/types.js";
import type { UnifiedObservation } from "../domain/unifiedObservation.js";

export class UncertaintyEventManager {
  private events = new Map<string, UncertaintyEvent & { expiresAt: number }>();
  private readonly defaultTtls: Record<UncertaintySourceFamily, number> = {
    acoustic: 300_000,    // 5 minutes
    thermal: 1_800_000,   // 30 minutes (FIRMS satellite passes)
    satellite: 1_800_000, // 30 minutes (EO / SAR)
    osint: 600_000,       // 10 minutes
    optical: 600_000,     // 10 minutes
    radar: 300_000        // 5 minutes
  };

  /**
   * Ingest a direct UncertaintyEvent
   */
  ingest(event: UncertaintyEvent, now = Date.now()): void {
    const ttl = event.ttlMs ?? this.defaultTtls[event.sourceFamily] ?? 300_000;
    this.events.set(event.id, {
      ...event,
      expiresAt: now + ttl
    });
  }

  /**
   * Ingest an observation that has wide spatial uncertainty or represents an indirect sensor contact
   */
  ingestObservation(obs: Observation | UnifiedObservation, now = Date.now()): UncertaintyEvent | null {
    const meta = (obs as any).meta || {};
    const src = (obs as any).source_id || obs.source || "unknown";
    const srcFamilyRaw = (obs as any).source_family || meta.source_family || "";

    let family: UncertaintySourceFamily = "osint";
    if (srcFamilyRaw === "acoustic" || src.includes("acoustic") || meta.reportType?.includes("sound")) {
      family = "acoustic";
    } else if (srcFamilyRaw === "thermal" || src.includes("firms") || obs.type === "thermal") {
      family = "thermal";
    } else if (srcFamilyRaw === "satellite" || src.includes("satellite") || src.includes("copernicus")) {
      family = "satellite";
    } else if (srcFamilyRaw === "optical" || src.includes("optical")) {
      family = "optical";
    } else if (srcFamilyRaw === "radar" || src.includes("radar")) {
      family = "radar";
    }

    const accuracy = (obs as any).measurement_accuracy || obs.uncertaintyRadius || (
      family === "acoustic" ? 12_000 :
      family === "thermal" ? 2_500 :
      family === "satellite" ? 800 :
      family === "osint" ? 3_500 : 2_000
    );

    const label = (obs as any).model || meta.model || (
      family === "acoustic" ? "🎯 Акустичний контакт (звук двигуна)" :
      family === "thermal" ? "🔥 Теплова аномалія (NASA FIRMS)" :
      family === "satellite" ? "🛰️ Супутникова детекція EO/SAR" :
      family === "osint" ? "📡 Повідомлення моніторингу" : "⚠️ Сенсорна зона"
    );

    const event: UncertaintyEvent = {
      id: `unc-${src}-${obs.id}`,
      lat: obs.lat,
      lon: obs.lon,
      uncertaintyRadius: accuracy,
      confidence: obs.confidence || 0.4,
      source: src,
      sourceFamily: family,
      label,
      timestamp: obs.timestamp || now,
      details: meta.comment || meta.details || meta.evidence?.toString() || (obs as any).threatEvidence?.toString()
    };

    this.ingest(event, now);
    return event;
  }

  /**
   * Remove expired events
   */
  pruneExpired(now = Date.now()): number {
    let pruned = 0;
    for (const [id, event] of this.events.entries()) {
      if (now >= event.expiresAt) {
        this.events.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Return all currently active events
   */
  getActiveEvents(now = Date.now()): UncertaintyEvent[] {
    this.pruneExpired(now);
    return Array.from(this.events.values()).map(({ expiresAt, ...event }) => event);
  }

  /**
   * Get count of active events
   */
  getCount(now = Date.now()): number {
    this.pruneExpired(now);
    return this.events.size;
  }

  /**
   * Spatial query: find events within radius of a given position
   */
  getEventsNear(lat: number, lon: number, radiusMeters: number, now = Date.now()): UncertaintyEvent[] {
    this.pruneExpired(now);
    const results: UncertaintyEvent[] = [];
    for (const item of this.events.values()) {
      const dist = haversineMeters({ lat, lon }, { lat: item.lat, lon: item.lon });
      // Event intersects if distance between centers <= radius + event.uncertaintyRadius
      if (dist <= radiusMeters + item.uncertaintyRadius) {
        const { expiresAt, ...event } = item;
        results.push(event);
      }
    }
    return results;
  }

  clear(): void {
    this.events.clear();
  }
}

export const uncertaintyEventManager = new UncertaintyEventManager();
