import { createUnifiedObservation, type UnifiedObservation } from "../domain/unifiedObservation.js";
import type { TrackType } from "../domain/types.js";
import {
  parseOsintImpact,
  parseOsintText,
  type ParsedOsintImpact
} from "../ingest/osintParser.js";
import { findCityInText, isInsideUkraineGeo } from "./ukraineGeo.js";
import { intelligenceStore, type PersistedOsintBulletin } from "../db/intelligenceStore.js";
import { query, getPool } from "../db/pool.js";

interface NonTelegramWebFeed {
  id: string;
  label: string;
  url: string;
}

const OFFICIAL_WEB_RSS_FEEDS: NonTelegramWebFeed[] = [
  {
    id: "gov:Укрінформ",
    label: "Укрінформ (Державне агентство)",
    url: "https://www.ukrinform.ua/rss/block-lastnews"
  },
  {
    id: "gov:АрміяInform",
    label: "АрміяInform (Міноборони України)",
    url: "https://armyinform.com.ua/feed/"
  },
  {
    id: "gov:Суспільне",
    label: "Суспільне Мовлення",
    url: "https://suspilne.media/rss/all.rss"
  },
  {
    id: "web:Українська Правда",
    label: "Українська Правда",
    url: "https://www.pravda.com.ua/rss/view_news/"
  },
  {
    id: "web:Еспресо",
    label: "Еспресо",
    url: "https://espreso.tv/rss"
  },
  {
    id: "web:Цензор.НЕТ",
    label: "Цензор.НЕТ",
    url: "https://censor.net/includes/news_uk.xml"
  }
];

const UKRAINE_ALARM_V3_URL = "https://siren.pp.ua/api/v3/alerts";

interface UkraineAlarmActiveAlert {
  regionId: string;
  regionType: "State" | "District" | "Community";
  type: "AIR" | "ARTILLERY" | "URBAN_FIGHTS" | "CHEMICAL" | "NUCLEAR" | string;
  lastUpdate: string;
}

interface UkraineAlarmRegionEntry {
  regionId: string;
  regionType: "State" | "District" | "Community";
  regionName: string;
  lastUpdate: string;
  activeAlerts?: UkraineAlarmActiveAlert[];
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Non-Telegram Departmental, State Civil-Defense & Public Web Bulletin Adapter.
 *
 * Telegram channels and chats (t.me / telegram.org) are strictly disconnected.
 * Ingests official district/community civil-defense threat telemetry (UkraineAlarm v3 / ДСНС / ОВА),
 * official Ukrainian state & defense agency RSS feeds (Укрінформ, АрміяInform, Суспільне),
 * and optional non-Telegram JSON endpoints configured via PUBLIC_OSINT_URL.
 */
export class PublicOsintFeedSource {
  private pendingImpactEvents: Array<ParsedOsintImpact & { id: string; channel: string }> = [];
  private seenImpactRefs = new Set<string>();
  private activeAlertOblasts = new Set<string>();
  private lastRssPollAt = 0;

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
      const persisted = await intelligenceStore.loadRecentBulletins(60 * 60 * 1000);
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
      activeBulletins: this.getLiveFeed(30).length,
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
    const bestByKey = new Map<string, UnifiedObservation>();
    const toPersist: PersistedOsintBulletin[] = [];

    // 1. Official State Civil-Defense District & Community Threat API (UkraineAlarm v3 / ДСНС / ОВА)
    try {
      const res = await fetch(UKRAINE_ALARM_V3_URL, {
        headers: { "User-Agent": "EyeRadar/2.0 (Civil Airspace Awareness; Non-Telegram)" },
        signal: AbortSignal.timeout(4500)
      });
      if (res.ok) {
        const regions = (await res.json()) as UkraineAlarmRegionEntry[];
        if (Array.isArray(regions)) {
          for (const reg of regions) {
            if (!reg?.regionName || !Array.isArray(reg.activeAlerts) || reg.activeAlerts.length === 0) {
              continue;
            }
            // Skip whole-oblast State entries (already rendered as oblast polygons) unless it is a specific city community (e.g. "м. Харків", "м. Запоріжжя")
            if (reg.regionType === "State" && !reg.regionName.trim().startsWith("м.")) {
              continue;
            }

            // Pick the freshest active alert on this district/community
            let freshestAlert: UkraineAlarmActiveAlert | null = null;
            let freshestTs = 0;
            for (const al of reg.activeAlerts) {
              const parsedTs = Date.parse(al.lastUpdate);
              if (Number.isFinite(parsedTs) && parsedTs > freshestTs) {
                freshestTs = parsedTs;
                freshestAlert = al;
              }
            }
            if (!freshestAlert || freshestTs <= 0) continue;

            // Only emit active district/community threat sectors updated within the last 6 hours
            if (now - freshestTs > 6 * 3600 * 1000) continue;

            const place = findCityInText(reg.regionName);
            if (!place || !isInsideUkraineGeo(place.lat, place.lon)) continue;

            const isArtillery = freshestAlert.type === "ARTILLERY";
            const isUrban = freshestAlert.type === "URBAN_FIGHTS";
            const trackType: TrackType = isArtillery ? "bomb" : "uav";
            const typeLabel = isArtillery
              ? "Загроза артобстрілу"
              : isUrban
              ? "Бойові дії в районі"
              : "Повітряна загроза";
            const modelName = `${typeLabel} · ${place.nameUk}`;
            const objectId = `osint-dsns-${reg.regionId}`;
            const postRef = `gov-ua-alarm-${reg.regionId}-${Math.floor(freshestTs / 60000)}`;
            const textSummary = `${typeLabel} — ${reg.regionName} (офіційне сповіщення ДСНС / ОВА)`;

            toPersist.push({
              postRef,
              channel: "gov:ДСНС / ОВА",
              text: textSummary,
              publishedAt: freshestTs,
              targetType: trackType,
              oblast: place.oblast,
              cityName: place.nameUk,
              lat: place.lat,
              lon: place.lon,
              model: modelName
            });

            const unified = createUnifiedObservation({
              source_id: "gov:ДСНС / ОВА",
              source_family: "osint",
              event_id: postRef,
              object_id: objectId,
              observed_at: now,
              published_at: now,
              received_at: now,
              lat: place.lat,
              lon: place.lon,
              heading: undefined,
              speed: 0,
              altitude: undefined,
              object_type: trackType,
              model: modelName,
              callsign: "ДСНС / ОВА",
              measurement_accuracy: reg.regionType === "Community" ? 4500 : 7500,
              source_quality: 0.92,
              confidence: 0.88,
              isSynthetic: false,
              evidence: ["official_air_force_bulletin", "air_defense_osint"],
              threatEvidence: ["official_air_force_bulletin", "air_defense_osint"],
              provenance: `ДСНС / ОВА (UkraineAlarm): «${textSummary}»`
            });
            bestByKey.set(objectId, unified);
          }
        }
      }
    } catch {
      // Tolerated gracefully if upstream mirror is temporarily unreachable
    }

    // 2. Official Ukrainian State & Defense Web RSS Feeds (polled every 45s to stay lightweight)
    if (now - this.lastRssPollAt >= 45_000) {
      this.lastRssPollAt = now;
      await Promise.allSettled(
        OFFICIAL_WEB_RSS_FEEDS.map(async (feed) => {
          try {
            const r = await fetch(feed.url, {
              headers: { "User-Agent": "EyeRadar/2.0 (Civil Airspace Awareness; Non-Telegram)" },
              signal: AbortSignal.timeout(4500)
            });
            if (!r.ok) return;
            const xml = await r.text();
            const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 15);
            for (const m of itemMatches) {
              const block = m[1];
              const rawTitle = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "";
              const rawPubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "";
              const rawGuid =
                block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] ||
                block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ||
                rawTitle;

              const title = decodeXmlEntities(rawTitle);
              if (!title || title.length < 10) continue;
              if (!/тривог|бпла|шахед|ракет|каб|вибух|ппо|повітрян|обстріл|дрон|атак|удар/i.test(title)) {
                continue;
              }

              const pubTs = Date.parse(decodeXmlEntities(rawPubDate));
              const effectiveTs = Number.isFinite(pubTs) ? pubTs : now;
              if (now - effectiveTs > 12 * 3600 * 1000) continue;

              const cleanRef = `rss-${feed.id}-${decodeXmlEntities(rawGuid)
                .replace(/[^a-zA-Z0-9_-]/g, "")
                .slice(-36)}`;

              if (!this.seenImpactRefs.has(cleanRef)) {
                const impact = parseOsintImpact(title, effectiveTs);
                if (impact) {
                  this.seenImpactRefs.add(cleanRef);
                  this.pendingImpactEvents.push({
                    ...impact,
                    id: `evt-${cleanRef}`,
                    channel: feed.label
                  });
                }
              }

              const place = findCityInText(title);
              if (place && isInsideUkraineGeo(place.lat, place.lon)) {
                toPersist.push({
                  postRef: cleanRef,
                  channel: feed.id,
                  text: title.slice(0, 400),
                  publishedAt: effectiveTs,
                  targetType: /ракет/i.test(title) ? "munition" : /каб|авіабомб/i.test(title) ? "bomb" : "uav",
                  oblast: place.oblast,
                  cityName: place.nameUk,
                  lat: place.lat,
                  lon: place.lon,
                  model: /ракет/i.test(title)
                    ? "Ракетна загроза"
                    : /каб|авіабомб/i.test(title)
                    ? "Авіабомба / КАБ"
                    : "Повітряна атака / БпЛА"
                });
              }
            }
          } catch {
            // Individual RSS feed failure is tolerated gracefully
          }
        })
      );
    }

    // 3. Optional External Non-Telegram Departmental JSON Endpoint (PUBLIC_OSINT_URL)
    const osintUrl = (process.env.PUBLIC_OSINT_URL || "").trim();
    if (osintUrl && !/t\.me|telegram\.(org|me)/i.test(osintUrl)) {
      try {
        const res = await fetch(osintUrl, {
          headers: { "User-Agent": "EyeRadar/2.0 (Civil Airspace Awareness; Non-Telegram)" },
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
    }

    if (toPersist.length > 0) {
      void intelligenceStore.saveBulletins(toPersist);
    }

    return Array.from(bestByKey.values());
  }
}
