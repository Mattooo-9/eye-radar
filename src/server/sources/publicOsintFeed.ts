import { createUnifiedObservation, type UnifiedObservation } from "../domain/unifiedObservation.js";
import { isStandDownMessage, parseOsintBulletin, parseOsintText } from "../ingest/osintParser.js";

interface RawBulletinEntry {
  channel: string;
  postRef: string;
  text: string;
  publishedAt: number;
}

const CHANNEL_META: Record<string, { label: string; reliability: number; defaultRegion?: string }> = {
  kpszsu: { label: "Повітряні Сили ЗСУ (@kpszsu)", reliability: 0.95 },
  radar_raketaa: { label: "Радар Ракета (@radar_raketaa)", reliability: 0.90 },
  radar_zp: { label: "Радар Запоріжжя (@radar_zp)", reliability: 0.89, defaultRegion: "Запорізька область" },
  monitor1654: { label: "Монітор 1654 Харків (@monitor1654)", reliability: 0.89, defaultRegion: "Харківщина" },
  tlknewsua: { label: "TLK Моніторинг (@tlknewsua)", reliability: 0.89, defaultRegion: "Харківщина" },
  raketa_trevoga: { label: "Монітор ППО (@raketa_trevoga)", reliability: 0.89 },
  dnipro_alerts: { label: "Дніпро Тривога (@dnipro_alerts)", reliability: 0.88, defaultRegion: "Дніпропетровщина" },
  monitoringwar: { label: "Monitoring War (@monitoringwar)", reliability: 0.88 },
  monitorwarr: { label: "Радар Моніторинг (@monitorwarr)", reliability: 0.88 },
  vanek_nikolaev: { label: "Очі Півдня (@vanek_nikolaev)", reliability: 0.90 },
  war_monitor: { label: "War Monitor (@war_monitor)", reliability: 0.89 }
};

function decodeHtmlText(rawHtml: string): string {
  return rawHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Public Official Air Defense OSINT & Spotter Feed Adapter ("Очі ППО")
 * Ingests empirical real-time air defense tracking alerts published by
 * the official Air Force of Ukraine (Повітряні Сили ЗСУ) and public monitoring channels.
 *
 * 100% EMPIRICAL - ZERO SYNTHESIS / ZERO SIMULATION.
 */
export class PublicOsintFeedSource {
  private lastHttpFetch = 0;
  private cachedBulletins: RawBulletinEntry[] = [];
  private latestStandDownByType = new Map<string, number>();
  private activeAlertOblasts = new Set<string>();

  setActiveAlertOblasts(oblasts: string[]): void {
    this.activeAlertOblasts = new Set(
      oblasts.map((o) => o.toLowerCase().replace("область", "").replace("обл.", "").trim())
    );
  }

  private hasActiveAlertForOblast(oblast?: string): boolean {
    if (this.activeAlertOblasts.size === 0 || !oblast) return true;
    const key = oblast.toLowerCase().replace("область", "").replace("обл.", "").trim();
    const ukSynonyms: Record<string, string[]> = {
      kyiv: ["київськ", "м. київ", "київ"],
      kharkiv: ["харківськ"],
      dnipropetrovsk: ["дніпропетровськ"],
      zaporizhzhia: ["запорізьк"],
      mykolaiv: ["миколаївськ"],
      odesa: ["одеськ"],
      poltava: ["полтавськ"],
      kirovohrad: ["кіровоградськ"],
      sumy: ["сумськ"],
      chernihiv: ["чернігівськ"],
      zhytomyr: ["житомирськ"],
      cherkasy: ["черкаськ"],
      vinnytsia: ["вінницьк"],
      rivne: ["рівненськ"],
      volyn: ["волинськ"],
      khmelnytskyi: ["хмельницьк"],
      ternopil: ["тернопільськ"],
      lviv: ["львівськ"],
      "ivano-frankivsk": ["івано-франківськ"],
      chernivtsi: ["чернівецьк"],
      zakarpattia: ["закарпатськ"],
      donetsk: ["донецьк"],
      luhansk: ["луганськ"],
      kherson: ["херсонськ"]
    };

    const probes = [key, ...(ukSynonyms[key] ?? [])];
    for (const active of this.activeAlertOblasts) {
      if (probes.some((p) => active.includes(p) || p.includes(active))) {
        return true;
      }
    }
    return false;
  }

  private async refreshRawBulletins(now: number): Promise<void> {
    if (now - this.lastHttpFetch < 12_000 && this.cachedBulletins.length > 0) {
      return;
    }

    this.lastHttpFetch = now;
    const channels = Object.keys(CHANNEL_META);
    const collected: RawBulletinEntry[] = [];
    const standDowns = new Map<string, number>();

    await Promise.allSettled(
      channels.map(async (channel) => {
        try {
          const res = await fetch(`https://t.me/s/${channel}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml"
            },
            signal: AbortSignal.timeout(6000)
          });

          if (!res.ok) return;
          const html = await res.text();
          const messageRegex =
            /<div class="tgme_widget_message\b[^>]*data-post="([^"]+)"[\s\S]*?<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>[\s\S]*?<time datetime="([^"]+)"/g;

          let match: RegExpExecArray | null;
          while ((match = messageRegex.exec(html)) !== null) {
            const postRef = match[1];
            const cleanText = decodeHtmlText(match[2]);
            const publishedAt = Date.parse(match[3]);
            if (isNaN(publishedAt)) continue;

            // Maximum empirical horizon: 30 minutes
            const ageMs = now - publishedAt;
            if (ageMs > 30 * 60 * 1000 || ageMs < -60_000) {
              continue;
            }

            if (isStandDownMessage(cleanText)) {
              const lower = cleanText.toLowerCase();
              if (lower.includes("баліст") || lower.includes("баллист") || lower.includes("ракет")) {
                standDowns.set("munition", Math.max(standDowns.get("munition") ?? 0, publishedAt));
              } else if (lower.includes("бпла") || lower.includes("шахед") || lower.includes("дрон")) {
                standDowns.set("uav", Math.max(standDowns.get("uav") ?? 0, publishedAt));
              }
              continue;
            }

            collected.push({
              channel,
              postRef,
              text: cleanText,
              publishedAt
            });
          }
        } catch {
          // Channel temporarily unavailable — tolerate gracefully
        }
      })
    );

    if (collected.length > 0 || standDowns.size > 0) {
      this.cachedBulletins = collected;
      this.latestStandDownByType = standDowns;
    }
  }

  async fetchPublicOsintObservations(): Promise<UnifiedObservation[]> {
    const now = Date.now();
    await this.refreshRawBulletins(now);

    const bestByCorridor = new Map<
      string,
      { obs: UnifiedObservation; publishedAt: number; reliability: number }
    >();

    for (const entry of this.cachedBulletins) {
      const chMeta = CHANNEL_META[entry.channel] ?? { label: `@${entry.channel}`, reliability: 0.85 };
      const parsedTargets = parseOsintBulletin(entry.text, entry.publishedAt, now, chMeta.defaultRegion);

      for (const target of parsedTargets) {
        const obsRaw = target.observation;
        const ageMs = now - entry.publishedAt;

        if (ageMs > target.maxAgeMs) continue;

        // If channel or network issued a newer stand-down for ballistic/missile or broad UAV alert, respect it
        const standDownTs = this.latestStandDownByType.get(obsRaw.type);
        if (standDownTs && standDownTs > entry.publishedAt && obsRaw.type === "munition") {
          continue;
        }

        // Cross-check official siren table for non-frontline deep-rear targets older than 3 minutes
        if (!target.isFrontline && ageMs > 180_000 && !this.hasActiveAlertForOblast(target.oblast)) {
          continue;
        }

        const ageMin = Math.max(0, Math.round(ageMs / 60_000));
        const ageTag = ageMin === 0 ? "щойно" : `${ageMin} хв тому`;
        const provenanceLabel = `${chMeta.label} · ${ageTag}: «${String(obsRaw.meta?.rawSnippet || "").slice(0, 90)}»`;

        const unified = createUnifiedObservation({
          source_id: "ukraine-air-defense-osint",
          source_family: "osint",
          sensorType: "air_defense_osint",
          event_id: `post-${entry.postRef.replace("/", "-")}`,
          object_id: target.corridorKey,
          observed_at: now,
          published_at: now,
          received_at: now,
          lat: obsRaw.lat,
          lon: obsRaw.lon,
          heading: obsRaw.heading,
          speed: obsRaw.speed,
          altitude: obsRaw.altitude,
          object_type: obsRaw.type,
          model: typeof obsRaw.meta?.model === "string" ? obsRaw.meta.model : undefined,
          callsign: `@${entry.channel}`,
          measurement_accuracy: obsRaw.uncertaintyRadius ?? 5000,
          source_quality: chMeta.reliability,
          confidence: chMeta.reliability,
          classConfidence: 0.88,
          isSynthetic: false,
          evidence: ["official_air_force_bulletin", "air_defense_osint", `channel_${entry.channel}`],
          threatEvidence: ["official_air_force_bulletin", "air_defense_osint"],
          provenance: provenanceLabel
        });

        const existing = bestByCorridor.get(target.corridorKey);
        if (
          !existing ||
          entry.publishedAt > existing.publishedAt ||
          (entry.publishedAt === existing.publishedAt && chMeta.reliability > existing.reliability)
        ) {
          bestByCorridor.set(target.corridorKey, {
            obs: unified,
            publishedAt: entry.publishedAt,
            reliability: chMeta.reliability
          });
        }
      }
    }

    // Optional external webhook/mirror if configured
    const osintUrl = process.env.PUBLIC_OSINT_URL;
    if (osintUrl) {
      try {
        const res = await fetch(osintUrl, {
          headers: { "User-Agent": "EyeRadar/5.0 (Civil Air Defense Awareness)" },
          signal: AbortSignal.timeout(4000)
        });
        if (res.ok) {
          const items = (await res.json()) as Array<{ id: string; source: string; text: string; timestamp: number }>;
          for (const item of items) {
            const ts = item.timestamp || now;
            if (now - ts > 25 * 60 * 1000) continue;
            const parsedList = parseOsintText(item.text, ts);
            for (const p of parsedList) {
              const unified = createUnifiedObservation({
                source_id: item.source || "osint-feed",
                source_family: "osint",
                event_id: `osint-${item.id}`,
                object_id: p.id,
                observed_at: now,
                published_at: ts,
                lat: p.lat,
                lon: p.lon,
                heading: p.heading,
                speed: p.speed,
                altitude: p.altitude,
                object_type: p.type,
                model: typeof p.meta?.model === "string" ? p.meta.model : undefined,
                measurement_accuracy: 2500,
                source_quality: 0.88,
                confidence: p.confidence,
                isSynthetic: false,
                evidence: ["public_osint_message", `channel_${item.source}`, "air_defense_osint"],
                threatEvidence: ["air_defense_osint"],
                provenance: `OSINT: ${item.source}`
              });
              bestByCorridor.set(p.id, { obs: unified, publishedAt: ts, reliability: 0.88 });
            }
          }
        }
      } catch {
        // Tolerated
      }
    }

    return Array.from(bestByCorridor.values()).map((v) => v.obs);
  }
}
