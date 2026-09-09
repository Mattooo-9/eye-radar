import { createHash } from "node:crypto";
import type { Observation, TrackType } from "../domain/types.js";
import { findCityInText, findDirectionInText, normalizeUkText } from "../sources/ukraineGeo.js";

const typeByKeyword: Array<{ keywords: string[]; type: TrackType }> = [
  {
    keywords: ["шахед", "shahed", "герань", "дрон", "мопед", "бпла", "uav", "крило", "розвідник"],
    type: "uav"
  },
  {
    keywords: [
      "ракета",
      "калібр",
      "х-101",
      "х-59",
      "х-69",
      "х-22",
      "кинджал",
      "кинжал",
      "балістика",
      "баллистика",
      "іскандер",
      "искандер",
      "циркон",
      "munition",
      "missile",
      "каб"
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
  /(?:(?<id>[A-Za-z0-9_-]{3,24})\s+)?(?:(?<typeKeyword>aircraft|helicopter|uav|drone|munition|missile|шахед|ракета)\s+)?(?<lat>\b[4-5]\d\.\d{2,7}\b)[,\s]+(?<lon>\b[2-4]\d\.\d{2,7}\b)(?:.*?(?<heading>\b\d{1,3}(?:\.\d+)?\b))?(?:.*?(?<speed>\b\d{1,4}(?:\.\d+)?\b))?/gi;

const detectType = (text: string): TrackType => {
  const lower = text.toLowerCase();
  for (const group of typeByKeyword) {
    for (const kw of group.keywords) {
      if (lower.includes(kw)) {
        return group.type;
      }
    }
  }
  return "unknown";
};

export const parseOsintText = (text: string, now = Date.now()): Observation[] => {
  const observations: Observation[] = [];
  const normalized = normalizeUkText(text);

  // 1. Try explicit coordinate regex matches
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
      confidence: 0.7
    });
  }

  // 2. If no numeric coordinates found, parse natural language city and direction
  if (observations.length === 0) {
    const city = findCityInText(text);
    if (city) {
      const type = detectType(text);
      const heading = findDirectionInText(text) ?? undefined;
      const id = `osint-${city.name.toLowerCase()}-${createHash("sha1").update(text).digest("hex").slice(0, 6)}`;

      observations.push({
        id,
        type: type !== "unknown" ? type : "uav",
        lat: city.lat,
        lon: city.lon,
        heading,
        speed: type === "munition" ? 220 : 45, // m/s (~800 km/h missile, ~160 km/h UAV)
        timestamp: now,
        source: "osint",
        confidence: 0.65,
        meta: {
          cityName: city.nameUk,
          rawSnippet: text.slice(0, 100)
        }
      });
    }
  }

  return observations;
};
