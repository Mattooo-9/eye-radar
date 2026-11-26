import { createHash } from "node:crypto";
import { destinationPoint, haversineMeters } from "../domain/geo.js";
import type { Observation, TrackType } from "../domain/types.js";
import {
  deobfuscateCyrillic,
  findCityInText,
  findDirectionInText,
  findGeoContextInText,
  normalizeUkText,
  UKRAINE_CITIES
} from "../sources/ukraineGeo.js";

const typeByKeyword: Array<{ keywords: string[]; type: TrackType }> = [
  {
    keywords: ["каб", "умпк", "умпб", "авіабомб", "авіаційна бомба", "керована авіабомба", "плануюча бомба", "glide bomb", "фаб-500", "фаб-1500"],
    type: "bomb"
  },
  {
    keywords: ["fpv", "фпв", "квадрокоптер", "ударний фпв", "фпв-дрон", "fpv-дрон", "молния", "молнія", "ланцет"],
    type: "fpv"
  },
  {
    keywords: ["реактив", "реактивний", "шахед", "shahed", "герань", "дрон", "мопед", "бпла", "uav", "крило", "розвідник", "ударних", "ударні", "ударний", "ударных", "ударный", "ударные", "zala", "supercam", "орлан"],
    type: "uav"
  },
  {
    keywords: [
      "ракета",
      "калібр",
      "калибр",
      "х-101",
      "х-59",
      "х-69",
      "х-22",
      "х-31",
      "кинджал",
      "кинжал",
      "балістика",
      "баллистика",
      "іскандер",
      "искандер",
      "циркон",
      "оникс",
      "онікс",
      "munition",
      "missile"
    ],
    type: "munition"
  },
  {
    keywords: ["літак", "винищувач", "бомбардувальник", "су-34", "су-35", "ту-95", "ту-22", "міг-31", "aircraft"],
    type: "aircraft"
  },
  {
    keywords: ["гелікоптер", "вертоліт", "вертолет", "ка-52", "мі-8", "мі-28", "helicopter"],
    type: "helicopter"
  }
];

const coordinatePattern =
  /(?:(?<id>[A-Za-z0-9_-]{3,24})\s+)?(?:(?<typeKeyword>aircraft|helicopter|uav|drone|munition|missile|шахед|ракета|каб|умпк|fpv|фпв|бомба)\s+)?(?<lat>\b[4-5]\d\.\d{2,7}\b)[,\s]+(?<lon>\b[2-4]\d\.\d{2,7}\b)(?:.*?(?<heading>\b\d{1,3}(?:\.\d+)?\b))?(?:.*?(?<speed>\b\d{1,4}(?:\.\d+)?\b))?/gi;

const detectType = (text: string): TrackType => {
  const lower = deobfuscateCyrillic(text).toLowerCase();
  for (const group of typeByKeyword) {
    for (const kw of group.keywords) {
      if (lower.includes(kw)) {
        return group.type;
      }
    }
  }
  return "unknown";
};

function classifyKinematics(effectiveType: TrackType, text: string): {
  speed: number;
  altitude: number;
  model?: string;
  maxAgeMs: number;
} {
  const lower = deobfuscateCyrillic(text).toLowerCase();
  const isReactive = lower.includes("реактив");
  const isShahed = lower.includes("шахед") || lower.includes("герань") || lower.includes("мопед") || lower.includes("ударн");
  const isRecon = lower.includes("розвід") || lower.includes("zala") || lower.includes("supercam") || lower.includes("орлан");
  const isMolniya = lower.includes("молния") || lower.includes("молнія") || lower.includes("ланцет");
  const isBallistic = lower.includes("баліст") || lower.includes("баллист") || lower.includes("іскандер") || lower.includes("искандер") || lower.includes("кинджал") || lower.includes("кинжал") || lower.includes("циркон") || lower.includes("оникс") || lower.includes("онікс");
  const isCruise = lower.includes("х-101") || lower.includes("калібр") || lower.includes("калибр") || lower.includes("х-59") || lower.includes("х-69") || lower.includes("х-22") || lower.includes("х-31") || lower.includes("ракета");

  if (effectiveType === "bomb") {
    return {
      speed: 235,
      altitude: 2800,
      model: lower.includes("1500") ? "КАБ-1500 (УМПК)" : lower.includes("умпб") ? "УМПБ Д-30СН" : "КАБ-500 (УМПК)",
      maxAgeMs: 6 * 60 * 1000
    };
  }

  if (effectiveType === "munition") {
    if (isBallistic) {
      return {
        speed: 850,
        altitude: 12000,
        model: lower.includes("кинджал") || lower.includes("кинжал")
          ? "Х-47М2 Кинджал"
          : lower.includes("циркон")
          ? "ЗМ22 Циркон"
          : "Балістична ракета (Іскандер-М)",
        maxAgeMs: 6 * 60 * 1000
      };
    }
    return {
      speed: 230,
      altitude: 90,
      model: isCruise ? "Крилата ракета (Х-101/Калібр)" : "Авіаційна ракета",
      maxAgeMs: 15 * 60 * 1000
    };
  }

  if (effectiveType === "fpv") {
    if (isMolniya) {
      return {
        speed: 32,
        altitude: 120,
        model: lower.includes("ланцет") ? "БпЛА Ланцет" : "Ударний БпЛА Молнія",
        maxAgeMs: 12 * 60 * 1000
      };
    }
    return {
      speed: 28,
      altitude: 55,
      model: lower.includes("опто") ? "FPV-дрон (Оптоволокно)" : "FPV-дрон (Ударний)",
      maxAgeMs: 10 * 60 * 1000
    };
  }

  if (effectiveType === "aircraft") {
    return {
      speed: 260,
      altitude: 9500,
      model: "Тактична авіація",
      maxAgeMs: 15 * 60 * 1000
    };
  }

  if (effectiveType === "helicopter") {
    return {
      speed: 65,
      altitude: 180,
      model: "Гелікоптер",
      maxAgeMs: 15 * 60 * 1000
    };
  }

  // Default: UAV classes
  if (isReactive) {
    return {
      speed: 125, // ~450 km/h
      altitude: 350,
      model: "Реактивний ударний БпЛА",
      maxAgeMs: 20 * 60 * 1000
    };
  }
  if (isRecon) {
    return {
      speed: 35,
      altitude: 1500,
      model: "Розвідувальний БпЛА",
      maxAgeMs: 25 * 60 * 1000
    };
  }
  return {
    speed: 52, // ~187 km/h
    altitude: 180,
    model: isShahed ? "Shahed-136 / Герань-2" : "БпЛА (невідомого типу)",
    maxAgeMs: 25 * 60 * 1000
  };
}

export const isStandDownMessage = (text: string): boolean => {
  const lower = deobfuscateCyrillic(text).toLowerCase();
  return (
    lower.includes("відбій") ||
    lower.includes("отбой") ||
    lower.includes("загроза минула") ||
    lower.includes("угроза миновала") ||
    lower.includes("локаційно втрачен") ||
    lower.includes("більше не фіксується") ||
    lower.includes("не фіксується") ||
    lower.includes("зник зі спостереження") ||
    lower.includes("зник з радарів") ||
    lower.includes("зникла з радарів") ||
    lower.includes("вже чисто") ||
    lower.includes("цілі відсутні") ||
    lower.includes("ціль зникла") ||
    lower.includes("чисто по ")
  );
};

const isNonThreatPost = (text: string): boolean => {
  const lower = deobfuscateCyrillic(text).toLowerCase();
  return (
    lower.includes("згідно зі звітом") ||
    lower.includes("було знищено") ||
    lower.includes("загалом") ||
    lower.includes("дружнього збору") ||
    lower.includes("збір на ") ||
    lower.includes("сбор на ") ||
    lower.includes("монобанк") ||
    lower.includes("донат") ||
    lower.includes("вакансі") ||
    lower.includes("уразили") ||
    lower.includes("нпз") ||
    lower.includes("нафтоперероб") ||
    lower.includes("deepstrike") ||
    lower.includes("channel created") ||
    lower.includes("актуальне посилання") ||
    lower.includes("нашій редакції") ||
    lower.includes("офіційний телеграм") ||
    (lower.includes("підписуйтесь") && lower.length < 180)
  );
};

/**
 * Parses a single observation clause cleanly at timestamp `now` without using wall-clock shifts.
 */
export const parseOsintText = (text: string, now = Date.now()): Observation[] => {
  const observations: Observation[] = [];

  // 1. Explicit coordinate regex matches
  for (const match of text.matchAll(coordinatePattern)) {
    const groups = match.groups;
    if (!groups || !groups.lat || !groups.lon) {
      continue;
    }

    const rawType = groups.typeKeyword ? detectType(groups.typeKeyword) : detectType(text);
    const id = groups.id || `osint-${createHash("sha1").update(`${groups.lat}:${groups.lon}:${now}`).digest("hex").slice(0, 8)}`;

    observations.push({
      id,
      type: rawType !== "unknown" ? rawType : "uav",
      lat: Number(groups.lat),
      lon: Number(groups.lon),
      heading: groups.heading ? Number(groups.heading) : undefined,
      speed: groups.speed ? Number(groups.speed) : undefined,
      timestamp: now,
      source: "osint",
      confidence: 0.85,
      isSynthetic: false,
      meta: {
        isSynthetic: false,
        evidence: "osint_threat_report",
        threatEvidence: "osint_threat_report"
      }
    });
  }

  // 2. Natural language parsing using structured Ukrainian/Russian geo & route extraction
  if (observations.length === 0) {
    const city = findCityInText(text);
    if (city) {
      const geo = findGeoContextInText(text);
      const type = detectType(text);
      const effectiveType = type !== "unknown" ? type : "uav";
      const heading = geo.approachHeading ?? findDirectionInText(text, city) ?? undefined;
      const kinematics = classifyKinematics(effectiveType, text);
      const id = `osint-${city.name.toLowerCase().replace(/[^a-z0-9]/g, "")}-${createHash("sha1").update(text).digest("hex").slice(0, 6)}`;

      observations.push({
        id,
        type: effectiveType,
        lat: city.lat,
        lon: city.lon,
        heading,
        speed: kinematics.speed,
        altitude: kinematics.altitude,
        timestamp: now,
        source: "osint",
        confidence: 0.85,
        isSynthetic: false,
        meta: {
          cityName: city.nameUk,
          rawSnippet: text.slice(0, 120),
          evidence: "osint_threat_report",
          threatEvidence: "osint_threat_report",
          isSynthetic: false,
          ...(kinematics.model ? { model: kinematics.model } : {})
        }
      });
    }
  }

  return observations;
};

export interface ParsedBulletinTarget {
  observation: Observation;
  oblast?: string;
  isFrontline: boolean;
  maxAgeMs: number;
  corridorKey: string;
}

const REGION_HEADER_KEYS = new Set(
  Object.entries(UKRAINE_CITIES)
    .filter(([, pt]) => pt.isRegion)
    .flatMap(([, pt]) => [normalizeUkText(pt.nameUk), ...(pt.aliases ?? []).map(normalizeUkText)])
);

function detectRegionHeader(line: string): string | undefined {
  const norm = normalizeUkText(line);
  if (norm.split(/\s+/).length > 4) return undefined;
  for (const h of REGION_HEADER_KEYS) {
    if (norm === h || norm.startsWith(`${h} `)) {
      return line;
    }
  }
  return undefined;
}

/**
 * Multi-line, multi-target parser for live Telegram air-defense monitoring feeds
 * (`kpszsu`, `tlknewsua`, `raketa_trevoga`, `monitorwarr`, `war_monitor`, `vanek_nikolaev`).
 * Returns structured corridor targets projected from `publishedAt` -> `referenceNow` without overshooting.
 */
export const parseOsintBulletin = (
  rawText: string,
  publishedAt: number,
  referenceNow = Date.now(),
  defaultRegion?: string
): ParsedBulletinTarget[] => {
  if (!rawText || rawText.trim().length < 5) return [];
  if (isStandDownMessage(rawText) || isNonThreatPost(rawText)) return [];

  // Strip repetitive promotional footers from Telegram monitoring bots
  const cleanedText = rawText
    .replace(/⚠️\s*TLK MAP ALERTS[\s\S]*/gi, "")
    .replace(/📷\s*TlkInst[\s\S]*/gi, "")
    .replace(/🎞\s*Канал со стримами[\s\S]*/gi, "")
    .replace(/➡\s*Підписатися[\s\S]*/gi, "")
    .replace(/ℹ️\s*Alerts Live[\s\S]*/gi, "")
    .trim();

  if (!cleanedText) return [];

  // Split by newlines or semicolons so multi-target alerts become separate radar objects
  const rawClauses = cleanedText
    .split(/\n+|;+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);

  const results: ParsedBulletinTarget[] = [];
  let currentRegionHeader: string | undefined = defaultRegion;

  for (let idx = 0; idx < rawClauses.length; idx++) {
    const clause = rawClauses[idx];
    const header = detectRegionHeader(clause);
    if (header) {
      currentRegionHeader = header;
      continue;
    }

    if (isStandDownMessage(clause) || isNonThreatPost(clause)) {
      continue;
    }

    const deobClause = deobfuscateCyrillic(clause);
    const detectedType = detectType(deobClause);
    const lowerClause = deobClause.toLowerCase();

    // Require an explicit threat keyword so random conversational lines aren't turned into phantom drones
    if (detectedType === "unknown") {
      continue;
    }

    const geo = findGeoContextInText(deobClause, currentRegionHeader);
    const anchorGeo = geo.primary ?? geo.destination;
    if (!anchorGeo) {
      continue;
    }

    // Skip broad preventive-only alerts ("Загроза балістики в областях") unless active launch/flight or specific town is stated
    const hasSpecificTown = !anchorGeo.point.isRegion;
    const isPreventiveOnly =
      (lowerClause.includes("загроза") || lowerClause.includes("угроза") || lowerClause.includes("активність")) &&
      !hasSpecificTown &&
      !lowerClause.includes("пуск") &&
      !lowerClause.includes("курсом") &&
      !lowerClause.includes("напрямк") &&
      !lowerClause.includes("летить") &&
      !lowerClause.includes("з півн") &&
      !lowerClause.includes("з півд") &&
      !lowerClause.includes("зі сходу") &&
      !lowerClause.includes("із заходу") &&
      !lowerClause.includes(" с ");
    if (isPreventiveOnly) {
      continue;
    }

    const kinematics = classifyKinematics(detectedType, deobClause);
    const elapsedSec = Math.max(0, (referenceNow - publishedAt) / 1000);
    if ((referenceNow - publishedAt) > kinematics.maxAgeMs) {
      continue;
    }

    let lat = anchorGeo.point.lat;
    let lon = anchorGeo.point.lon;
    const heading = geo.approachHeading;

    if (geo.origin && geo.destination && typeof heading === "number") {
      // Corridor "Origin -> Destination": interpolate smoothly from 35% of route toward Destination
      const totalDistM = haversineMeters(
        geo.origin.point.lat,
        geo.origin.point.lon,
        geo.destination.point.lat,
        geo.destination.point.lon
      );
      const startOffsetM = Math.min(totalDistM * 0.35, 35_000);
      const advanceM = Math.min(totalDistM - 2_000, startOffsetM + kinematics.speed * elapsedSec);
      const pt = destinationPoint(
        geo.origin.point.lat,
        geo.origin.point.lon,
        heading,
        Math.max(0, advanceM)
      );
      lat = pt.lat;
      lon = pt.lon;
    } else if (geo.destination && geo.isApproachingDestination && typeof heading === "number") {
      // Incoming vector "на <Destination> з <Direction>":
      // Start upstream from Destination on approach sector and advance smoothly WITHOUT overshooting Destination!
      const leadDistM = detectedType === "bomb" || detectedType === "fpv" ? 14_000 : 28_000;
      const upstreamBearing = (heading + 180) % 360;
      const startPt = destinationPoint(
        geo.destination.point.lat,
        geo.destination.point.lon,
        upstreamBearing,
        leadDistM
      );
      const maxTravelM = Math.max(2_000, leadDistM - 2_500);
      const traveledM = Math.min(maxTravelM, kinematics.speed * elapsedSec);
      const pt = destinationPoint(startPt.lat, startPt.lon, heading, traveledM);
      lat = pt.lat;
      lon = pt.lon;
    } else if (typeof heading === "number") {
      // Explicit outgoing course from city: advance conservatively along course (capped to 25 km max per bulletin)
      const traveledM = Math.min(25_000, kinematics.speed * elapsedSec);
      if (traveledM > 100) {
        const pt = destinationPoint(lat, lon, heading, traveledM);
        lat = pt.lat;
        lon = pt.lon;
      }
    }

    const headingBucket = typeof heading === "number" ? Math.round(heading / 45) * 45 : "area";
    const targetTownKey = (geo.destination?.key || anchorGeo.key).toLowerCase().replace(/[^a-z0-9]/g, "");
    const corridorKey = `osint-${detectedType}-${targetTownKey}-${headingBucket}`;

    const isFrontline = Boolean(
      anchorGeo.point.isFrontline || geo.destination?.point.isFrontline || geo.origin?.point.isFrontline
    );
    const oblast = geo.destination?.point.oblast || anchorGeo.point.oblast;
    const isReactive = lowerClause.includes("реактив");
    const uncertaintyRadius = anchorGeo.point.isRegion ? 18_000 : detectedType === "fpv" || detectedType === "bomb" ? 3_500 : 6_500;

    // Extract count badge (e.g. "4 БпЛА", "3 ударных", "2х ракети") if present in the clause
    const countMatch = clause.match(/^\s*(?:⚠️|🛵|🏍|🚀|💣)?\s*(\d{1,2})\s*[хx]?\s+(?=реактив|ударн|бпла|шахед|ракет|каб|fpv|фпв)/i);
    const groupCount = countMatch ? Number(countMatch[1]) : 1;
    const displayModel =
      groupCount > 1 && kinematics.model
        ? `${groupCount}х ${kinematics.model}`
        : kinematics.model;

    results.push({
      observation: {
        id: corridorKey,
        type: detectedType,
        lat,
        lon,
        heading,
        speed: kinematics.speed,
        altitude: kinematics.altitude,
        timestamp: referenceNow,
        source: "osint",
        confidence: isReactive || detectedType === "munition" || detectedType === "bomb" ? 0.90 : 0.88,
        uncertaintyRadius,
        isSynthetic: false,
        threatEvidence: ["official_air_force_bulletin", "air_defense_osint"],
        meta: {
          cityName: geo.destination?.point.nameUk || anchorGeo.point.nameUk,
          rawSnippet: clause.slice(0, 140),
          published_at: publishedAt,
          evidence: "official_air_force_bulletin",
          threatEvidence: "official_air_force_bulletin",
          isSynthetic: false,
          ...(displayModel ? { model: displayModel } : {})
        }
      },
      oblast,
      isFrontline,
      maxAgeMs: kinematics.maxAgeMs,
      corridorKey
    });
  }

  return results;
};
