import type { Observation, TrackType } from "../domain/types.js";

const typeByToken: Record<string, TrackType> = {
  aircraft: "aircraft",
  helicopter: "helicopter",
  uav: "uav",
  drone: "uav",
  munition: "munition",
  missile: "munition"
};

const coordinatePattern =
  /(?<id>[A-Za-z0-9_-]{3,24}).*?(?<type>aircraft|helicopter|uav|drone|munition|missile).*?(?<lat>-?\d{1,2}\.\d+)[,\s]+(?<lon>-?\d{1,3}\.\d+)(?:.*?(?<heading>\d{1,3}(?:\.\d+)?))?(?:.*?(?<speed>\d{1,4}(?:\.\d+)?))?/gi;

export const parseOsintText = (text: string, now = Date.now()): Observation[] => {
  const observations: Observation[] = [];

  for (const match of text.matchAll(coordinatePattern)) {
    const groups = match.groups;
    if (!groups) {
      continue;
    }

    observations.push({
      id: groups.id,
      type: typeByToken[groups.type.toLowerCase()] ?? "unknown",
      lat: Number(groups.lat),
      lon: Number(groups.lon),
      heading: groups.heading ? Number(groups.heading) : undefined,
      speed: groups.speed ? Number(groups.speed) : undefined,
      timestamp: now,
      source: "osint",
      confidence: 0.65
    });
  }

  return observations;
};
