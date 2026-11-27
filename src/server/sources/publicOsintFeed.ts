import { createUnifiedObservation, type UnifiedObservation } from "../domain/unifiedObservation.js";
import {
  parseOsintImpact,
  parseOsintText,
  type ParsedOsintImpact
} from "../ingest/osintParser.js";
import { intelligenceStore, type PersistedOsintBulletin } from "../db/intelligenceStore.js";
import { query, getPool } from "../db/pool.js";

/**
 * Non-Telegram Departmental & Public Web Bulletin Adapter.
 *
 * Telegram channels and chats (t.me / telegram.org) are strictly disconnected.
 * Accepts only non-Telegram JSON/Web endpoints configured via PUBLIC_OSINT_URL
 * or authenticated departmental pushes via POST /api/ingest/osint.
 */
export class PublicOsintFeedSource {
  private pendingImpactEvents: Array<ParsedOsintImpact & { id: string; channel: string }> = [];
  private seenImpactRefs = new Set<string>();
  private activeAlertOblasts = new Set<string>();

  /**
   * Purges any legacy Telegram-sourced bulletins from Neon PostgreSQL on startup
   * and loads only non-Telegram web/departmental bulletins.
   */
  async hydrateFromDb(): Promise<number> {
    try {
      const pool = getPool();
      if (pool) {
        await query(
          `DELETE FROM osint_bulletins
           WHERE channel NOT LIKE 'gov:%' AND channel NOT LIKE 'web:%'`
        );
      }
      intelligenceStore.clearMemoryBulletins();
      const persisted = await intelligenceStore.loadRecentBulletins(15 * 60 * 1000);
      return persisted.filter((p) => p.channel.startsWith("gov:") || p.channel.startsWith("web:")).length;
    } catch {
      return 0;
    }
  }

  drainImpactEvents(): Array<ParsedOsintImpact & { id: string; channel: string }> {
    const out = this.pendingImpactEvents;
    this.pendingImpactEvents = [];
    return out;
  }

  getChannelSummary(): {
    totalChannels: number;
    respondingChannels: number;
    activeBulletins: number;
    telegramScrapingDisabled: boolean;
  } {
    return {
      totalChannels: 0,
      respondingChannels: 0,
      activeBulletins: this.getLiveFeed(25).length,
      telegramScrapingDisabled: true
    };
  }

  getLiveFeed(limit = 25): Array<PersistedOsintBulletin & { channelLabel: string }> {
    return intelligenceStore
      .getLatestFeedItems(limit)
      .filter((b) => b.channel.startsWith("gov:") || b.channel.startsWith("web:"))
      .map((b) => ({
        ...b,
        channelLabel: b.channel.replace(/^(gov|web):/i, "")
      }));
  }

  setActiveAlertOblasts(oblasts: string[]): void {
    this.activeAlertOblasts = new Set(
      oblasts.map((o) => o.toLowerCase().replace("область", "").replace("обл.", "").trim())
    );
  }

  async fetchPublicOsintObservations(): Promise<UnifiedObservation[]> {
    const now = Date.now();
    const osintUrl = (process.env.PUBLIC_OSINT_URL || "").trim();

    // Never fetch from Telegram domains (t.me, telegram.me, telegram.org)
    if (!osintUrl || /t\.me|telegram\.(org|me)/i.test(osintUrl)) {
      return [];
    }

    const bestByKey = new Map<string, UnifiedObservation>();
    const toPersist: PersistedOsintBulletin[] = [];

    try {
      const res = await fetch(osintUrl, {
        headers: { "User-Agent": "EyeRadar/2.0 (Civil Airspace Awareness)" },
        signal: AbortSignal.timeout(4500)
      });
      if (res.ok) {
        const items = (await res.json()) as Array<{
          id: string;
          source: string;
          text: string;
          timestamp: number;
        }>;
        for (const item of items) {
          if (!item?.text || /t\.me|telegram|@/i.test(item.source || "")) continue;
          const ts = item.timestamp || now;
          if (now - ts > 12 * 60 * 1000) continue;

          const sourceKey = `gov:${(item.source || "official-web").slice(0, 48)}`;
          if (!this.seenImpactRefs.has(item.id)) {
            const impact = parseOsintImpact(item.text, ts);
            if (impact) {
              this.seenImpactRefs.add(item.id);
              this.pendingImpactEvents.push({
                ...impact,
                id: `gov-evt-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
                channel: item.source || "Офіційне повідомлення"
              });
            }
          }

          const parsedList = parseOsintText(item.text, ts);
          for (const p of parsedList) {
            toPersist.push({
              postRef: `gov-${item.id}`,
              channel: sourceKey,
              text: item.text.slice(0, 500),
              publishedAt: ts,
              targetType: p.type,
              cityName: typeof p.meta?.cityName === "string" ? p.meta.cityName : undefined,
              lat: p.lat,
              lon: p.lon,
              model: typeof p.meta?.model === "string" ? p.meta.model : undefined
            });

            const unified = createUnifiedObservation({
              source_id: sourceKey,
              source_family: "osint",
              event_id: `gov-${item.id}`,
              object_id: p.id,
              observed_at: now,
              published_at: now,
              received_at: now,
              lat: p.lat,
              lon: p.lon,
              heading: p.heading,
              speed: 0,
              altitude: undefined,
              object_type: p.type,
              model: typeof p.meta?.model === "string" ? p.meta.model : undefined,
              callsign: item.source || "Відомче зведення",
              measurement_accuracy: 4500,
              source_quality: 0.9,
              confidence: p.confidence,
              isSynthetic: false,
              evidence: ["public_osint_message", "air_defense_osint"],
              threatEvidence: ["air_defense_osint"],
              provenance: `${item.source || "Офіційне зведення"}: «${item.text.slice(0, 100)}»`
            });
            bestByKey.set(p.id, unified);
          }
        }
      }
    } catch {
      // Tolerated gracefully
    }

    if (toPersist.length > 0) {
      void intelligenceStore.saveBulletins(toPersist);
    }

    return Array.from(bestByKey.values());
  }
}
