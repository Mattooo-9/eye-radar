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
    keywords: ["каб", "умпк", "умпб", "авіабомб", "авіаційна бомба", "керована авіабомба", "плануюча бомба", "glide bomb", "фаб-500", "фаб-1500", "фаб-250", "фаб-3000", "одаб"],
    type: "bomb"
  },
  {
    keywords: ["fpv", "фпв", "квадрокоптер", "ударний фпв", "фпв-дрон", "fpv-дрон", "молния", "молнія", "ланцет"],
    type: "fpv"
  },
  {
    keywords: ["герань-5", "реактив", "реактивний", "шахед", "shahed", "герань", "гербера", "пародія", "італмас", "дрон", "мопед", "бпла", "uav", "крило", "розвідник", "ударних", "ударні", "ударний", "ударных", "ударный", "ударные", "zala", "supercam", "орлан"],
    type: "uav"
  },
  {
    keywords: [
      "ракета",
      "калібр",
      "калибр",
      "х-101",
      "х-555",
      "х-59",
      "х-69",
      "х-35",
      "х-22",
      "х-31",
      "кинджал",
      "кинжал",
      "балістика",
      "баллистика",
      "аеробаліст",
      "іскандер",
      "искандер",
      "с-300",
      "с-400",
      "kn-23",
      "циркон",
      "оникс",
      "онікс",
      "орешнік",
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
  model?: string;
  maxAgeMs: number;
} {
  const lower = deobfuscateCyrillic(text).toLowerCase();
  const isReactive = lower.includes("реактив") || lower.includes("герань-5");
  const isExplicitShahed = lower.includes("шахед") || lower.includes("shahed") || lower.includes("герань") || lower.includes("мопед");
  const isStrikeUav = lower.includes("ударн");
  const isRecon = lower.includes("розвід") || lower.includes("zala") || lower.includes("supercam") || lower.includes("орлан");
  const isMolniya = lower.includes("молния") || lower.includes("молнія") || lower.includes("ланцет");
  const isBallistic = lower.includes("баліст") || lower.includes("баллист") || lower.includes("іскандер") || lower.includes("искандер") || lower.includes("кинджал") || lower.includes("кинжал") || lower.includes("циркон") || lower.includes("оникс") || lower.includes("онікс") || lower.includes("с-300") || lower.includes("с-400") || lower.includes("kn-23") || lower.includes("орешнік");
  const isCruise = lower.includes("х-101") || lower.includes("х-555") || lower.includes("калібр") || lower.includes("калибр") || lower.includes("х-59") || lower.includes("х-69") || lower.includes("х-35") || lower.includes("х-22") || lower.includes("х-31") || lower.includes("ракета");

  if (effectiveType === "bomb") {
    return {
      speed: 0,
      model: lower.includes("1500") ? "КАБ-1500" : lower.includes("умпб") ? "УМПБ" : "КАБ",
      maxAgeMs: 6 * 60 * 1000
    };
  }

  if (effectiveType === "munition") {
    if (isBallistic) {
      return {
        speed: 0,
        model: lower.includes("кинджал") || lower.includes("кинжал")
          ? "Аеробалістична ціль (Кинджал)"
          : lower.includes("циркон")
          ? "Гіперзвукова ціль (Циркон)"
          : "Балістична загроза",
        maxAgeMs: 6 * 60 * 1000
      };
    }
    return {
      speed: 0,
      model: isCruise ? "Крилата ракета" : "Ракетна загроза",
      maxAgeMs: 10 * 60 * 1000
    };
  }

  if (effectiveType === "fpv") {
    if (isMolniya) {
      return {
        speed: 0,
        model: lower.includes("ланцет") ? "БпЛА Ланцет" : "БпЛА Молнія",
        maxAgeMs: 8 * 60 * 1000
      };
    }
    return {
      speed: 0,
      model: lower.includes("опто") ? "FPV-дрон (оптоволокно)" : "FPV-дрон",
      maxAgeMs: 8 * 60 * 1000
    };
  }

  if (effectiveType === "aircraft") {
    return {
      speed: 0,
      model: "Тактична авіація",
      maxAgeMs: 10 * 60 * 1000
    };
  }

  if (effectiveType === "helicopter") {
    return {
      speed: 0,
      model: "Гелікоптер",
      maxAgeMs: 10 * 60 * 1000
    };
  }

  // Truthful UAV descriptors: never upgrade generic "БпЛА" to specific hardware models unless stated in text,
  // and never assign fake measured speeds to textual OSINT bulletins
  if (isReactive) {
    return {
      speed: 0,
      model: "Реактивний БпЛА",
      maxAgeMs: 12 * 60 * 1000
    };
  }
  if (isRecon) {
    return {
      speed: 0,
      model: "Розвідувальний БпЛА",
      maxAgeMs: 12 * 60 * 1000
    };
  }
  if (isExplicitShahed) {
    return {
      speed: 0,
      model: "Shahed / Герань",
      maxAgeMs: 12 * 60 * 1000
    };
  }
  return {
    speed: 0,
    model: isStrikeUav ? "Ударний БпЛА" : "БпЛА (тип не уточнено)",
    maxAgeMs: 12 * 60 * 1000
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
        altitude: undefined,
        timestamp: now,
        source: "osint",
        confidence: 0.85,
        isSynthetic: false,
        meta: {
          cityName: city.nameUk,
          rawSnippet: text.slice(0, 120),
          speedIsMeasured: false,
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
    if ((referenceNow - publishedAt) > kinematics.maxAgeMs) {
      continue;
    }

    // Never turn a textual OSINT message into a fake moving radar track:
    // Anchor position directly to the reported destination/settlement with its spatial uncertainty radius.
    const targetPoint = (geo.destination ?? anchorGeo).point;
    const lat = targetPoint.lat;
    const lon = targetPoint.lon;
    const heading = geo.approachHeading;

    const targetTownKey = (geo.destination?.key || anchorGeo.key).toLowerCase().replace(/[^a-z0-9]/g, "");
    const corridorKey = `osint-${detectedType}-${targetTownKey}`;

    const isFrontline = Boolean(
      anchorGeo.point.isFrontline || geo.destination?.point.isFrontline || geo.origin?.point.isFrontline
    );
    const oblast = geo.destination?.point.oblast || anchorGeo.point.oblast;
    const isReactive = lowerClause.includes("реактив");
    const uncertaintyRadius = targetPoint.isRegion ? 18_000 : detectedType === "fpv" || detectedType === "bomb" ? 3_500 : 6_500;

    // Extract count badge (e.g. "4 БпЛА", "3 ударных", "2х ракети") if present in the clause
    const countMatch = clause.match(/^\s*(?:⚠️|🛵|🏍|🚀|💣)?\s*(\d{1,2})\s*[хx]?\s+(?=реактив|ударн|бпла|шахед|ракет|каб|fpv|фпв)/i);
    const groupCount = countMatch ? Number(countMatch[1]) : 1;
    const displayModel =
      groupCount > 1 && kinematics.model ? `${groupCount}х ${kinematics.model}` : kinematics.model;

    results.push({
      observation: {
        id: corridorKey,
        type: detectedType,
        lat,
        lon,
        heading,
        // Textual OSINT messages NEVER carry radar-measured speed (0 = stationary settlement/sector warning)
        speed: 0,
        altitude: undefined,
        timestamp: referenceNow,
        source: "osint",
        confidence: isReactive || detectedType === "munition" || detectedType === "bomb" ? 0.88 : 0.84,
        uncertaintyRadius,
        isSynthetic: false,
        threatEvidence: ["official_air_force_bulletin", "air_defense_osint"],
        meta: {
          cityName: geo.destination?.point.nameUk || anchorGeo.point.nameUk,
          rawSnippet: clause.slice(0, 140),
          published_at: publishedAt,
          speedIsMeasured: false,
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

export interface ParsedOsintImpact {
  type: "impact" | "intercept";
  lat: number;
  lon: number;
  region: string;
  targetModel: string;
  targetType: TrackType;
  details: string;
  timestamp: number;
}

/**
 * Extracts verified live explosion / impact / air-defense interception reports from Ukrainian OSINT posts.
 * Zero fabrication: strictly matches explicit active impact or PVO interception reports with geolocated Ukrainian towns.
 */
export const parseOsintImpact = (
  rawText: string,
  publishedAt: number,
  defaultRegion?: string
): ParsedOsintImpact | null => {
  if (!rawText || isNonThreatPost(rawText) || isStandDownMessage(rawText)) return null;
  const deob = deobfuscateCyrillic(rawText);
  const lower = deob.toLowerCase();

  const isIntercept =
    lower.includes("робота ппо") ||
    lower.includes("працює ппо") ||
    lower.includes("збито") ||
    lower.includes("збита ") ||
    lower.includes("збили ") ||
    lower.includes("знищено бпла") ||
    lower.includes("відпрацювала ппо");

  const isImpact =
    lower.includes("вибух у") ||
    lower.includes("вибухи у") ||
    lower.includes("вибух в") ||
    lower.includes("вибухи в") ||
    lower.includes("чутно вибух") ||
    lower.includes("приліт у") ||
    lower.includes("приліт в") ||
    lower.includes("прильот") ||
    lower.includes("влучання");

  if (!isIntercept && !isImpact) return null;

  const geo = findGeoContextInText(deob, defaultRegion);
  const anchor = geo.destination ?? geo.primary;
  if (!anchor) return null;

  const detected = detectType(deob);
  const targetType: TrackType = detected !== "unknown" ? detected : "uav";
  const kinematics = classifyKinematics(targetType, deob);

  return {
    type: isIntercept ? "intercept" : "impact",
    lat: anchor.point.lat,
    lon: anchor.point.lon,
    region: anchor.point.nameUk,
    targetModel: kinematics.model || "Повітряна ціль",
    targetType,
    details: deob.replace(/\s+/g, " ").trim().slice(0, 140),
    timestamp: publishedAt
  };
};
