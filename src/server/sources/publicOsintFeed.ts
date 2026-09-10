import { createUnifiedObservation, type UnifiedObservation } from "../domain/unifiedObservation.js";
import { parseOsintText } from "../ingest/osintParser.js";

interface PublicOsintItem {
  id: string;
  source: string;
  text: string;
  timestamp: number;
}

/**
 * Public OSINT & Cascade Aggregator Adapter
 * Polls allowed public aviation / civil air defense monitoring feeds
 * and converts them into standardized UnifiedObservation instances.
 */
export class PublicOsintFeedSource {
  private lastFetch = 0;
  private seenIds = new Set<string>();

  async fetchPublicOsintObservations(): Promise<UnifiedObservation[]> {
    const now = Date.now();
    // Cache / poll interval 15 seconds
    if (now - this.lastFetch < 15_000) {
      return [];
    }

    this.lastFetch = now;
    const observations: UnifiedObservation[] = [];

    // Check public civil monitoring endpoint or fallback to simulated monitoring pulse
    try {
      // If a public OSINT webhook or mirror URL is configured:
      const osintUrl = process.env.PUBLIC_OSINT_URL;
      if (osintUrl) {
        const res = await fetch(osintUrl, {
          headers: { "User-Agent": "EyeRadar/4.0 (Civil Air Defense Awareness)" },
          signal: AbortSignal.timeout(4000)
        });
        if (res.ok) {
          const items = (await res.json()) as PublicOsintItem[];
          for (const item of items) {
            if (!this.seenIds.has(item.id)) {
              this.seenIds.add(item.id);
              const parsedList = parseOsintText(item.text, item.timestamp || now);
              for (const p of parsedList) {
                observations.push(createUnifiedObservation({
                  source_id: item.source || "osint-feed",
                  source_family: "osint",
                  event_id: `osint-${item.id}`,
                  object_id: p.id,
                  observed_at: p.timestamp,
                  lat: p.lat,
                  lon: p.lon,
                  heading: p.heading,
                  speed: p.speed,
                  altitude: p.altitude,
                  object_type: p.type,
                  measurement_accuracy: 1500, // natural language coordinate estimate
                  source_quality: 0.82,
                  confidence: p.confidence,
                  evidence: ["public_osint_message", `channel_${item.source}`],
                  provenance: `OSINT Channel: ${item.source}`
                }));
              }
            }
          }
        }
      }
    } catch {
      // Tolerated
    }

    // Keep seenIds bounded
    if (this.seenIds.size > 500) {
      this.seenIds.clear();
    }

    return observations;
  }
}
