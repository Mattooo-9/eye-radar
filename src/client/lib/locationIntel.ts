import { haversineMeters, bearingDegrees } from "./geo";
import { findNearestLandmark } from "./landmarks";
import { getTargetSpecification, getAltitudeAnalysis } from "./targetSpecs";
import type { TrackPacket } from "../hooks/useWsRadar";

export interface NearbyThreat {
  id: string;
  type: string;
  modelName: string;
  distanceKm: number;
  altitudeM: number;
  flightLevel: string;
  speedKmh: number;
  heading: number;
  isApproaching: boolean;
  etaMinutes: number | null;
  etaSeconds: number | null;
  corridorBadgeColor: string;
}

export interface LocationIntel {
  lat: number;
  lon: number;
  landmarkDesc: string;
  regionName: string;
  hasActiveAlert: boolean;
  alertTypeDesc: string;
  nearbyThreats: NearbyThreat[];
  closestThreat: NearbyThreat | null;
  summaryStatus: "CRITICAL" | "WARNING" | "CLEAR";
}

// Map Ukrainian regions to canonical names used in alerts.in.ua
const OBLAST_KEYWORDS: Record<string, string[]> = {
  "Київська": ["київ", "київськ"],
  "Чернігівська": ["чернігів", "чернігівськ"],
  "Сумська": ["сумськ", "суми"],
  "Харківська": ["харків", "харківськ"],
  "Полтавська": ["полтав", "полтавськ"],
  "Дніпропетровська": ["дніпро", "дніпропетровськ", "кривий ріг"],
  "Запорізька": ["запоріз", "запорізьк"],
  "Донецька": ["донецьк", "донецька"],
  "Луганська": ["луганськ", "луганська"],
  "Херсонська": ["херсон", "херсонськ"],
  "Миколаївська": ["миколаїв", "миколаївськ"],
  "Одеська": ["одес", "одеська"],
  "Кіровоградська": ["кіровоград", "кропивницьк"],
  "Черкаська": ["черкас", "черкаська"],
  "Житомирська": ["житомир", "житомирськ"],
  "Вінницька": ["вінниц", "вінницька"],
  "Хмельницька": ["хмельницьк"],
  "Рівненська": ["рівнен", "рівне"],
  "Волинська": ["волин", "луцьк"],
  "Львівська": ["львів", "львівськ"],
  "Тернопільська": ["тернопіль", "тернопільськ"],
  "Івано-Франківська": ["івано-франківськ", "прикарпаття"],
  "Закарпатська": ["закарпат", "ужгород"],
  "Чернівецька": ["чернівецьк", "буковина"],
  "Крим": ["крим", "севастополь"]
};

export function detectRegionFromCoordinates(lat: number, lon: number): string {
  // Approximate Ukrainian regional bounding boxes
  if (lat >= 50.0 && lat <= 51.6 && lon >= 29.2 && lon <= 32.2) return "Київська область";
  if (lat >= 50.5 && lat <= 52.4 && lon >= 30.5 && lon <= 33.5) return "Чернігівська область";
  if (lat >= 50.0 && lat <= 52.4 && lon >= 33.0 && lon <= 35.7) return "Сумська область";
  if (lat >= 48.8 && lat <= 50.5 && lon >= 35.0 && lon <= 38.3) return "Харківська область";
  if (lat >= 48.7 && lat <= 50.5 && lon >= 32.0 && lon <= 35.5) return "Полтавська область";
  if (lat >= 47.4 && lat <= 49.2 && lon >= 33.1 && lon <= 36.9) return "Дніпропетровська область";
  if (lat >= 46.7 && lat <= 48.3 && lon >= 34.5 && lon <= 37.3) return "Запорізька область";
  if (lat >= 46.8 && lat <= 49.3 && lon >= 36.5 && lon <= 39.2) return "Донецька область";
  if (lat >= 48.0 && lat <= 50.1 && lon >= 38.0 && lon <= 40.3) return "Луганська область";
  if (lat >= 45.8 && lat <= 47.6 && lon >= 31.5 && lon <= 35.0) return "Херсонська область";
  if (lat >= 46.3 && lat <= 48.2 && lon >= 30.2 && lon <= 33.2) return "Миколаївська область";
  if (lat >= 45.2 && lat <= 48.2 && lon >= 29.5 && lon <= 31.4) return "Одеська область";
  if (lat >= 47.8 && lat <= 49.2 && lon >= 31.0 && lon <= 33.6) return "Кіровоградська область";
  if (lat >= 48.5 && lat <= 50.2 && lon >= 31.0 && lon <= 32.9) return "Черкаська область";
  if (lat >= 49.5 && lat <= 51.7 && lon >= 27.2 && lon <= 29.8) return "Житомирська область";
  if (lat >= 48.1 && lat <= 49.9 && lon >= 27.3 && lon <= 30.1) return "Вінницька область";
  if (lat >= 48.5 && lat <= 50.6 && lon >= 26.1 && lon <= 27.9) return "Хмельницька область";
  if (lat >= 50.0 && lat <= 51.9 && lon >= 25.1 && lon <= 27.4) return "Рівненська область";
  if (lat >= 50.4 && lat <= 51.9 && lon >= 23.6 && lon <= 26.0) return "Волинська область";
  if (lat >= 48.8 && lat <= 50.6 && lon >= 22.7 && lon <= 25.4) return "Львівська область";
  if (lat >= 48.8 && lat <= 50.3 && lon >= 24.9 && lon <= 26.3) return "Тернопільська область";
  if (lat >= 47.7 && lat <= 49.3 && lon >= 23.6 && lon <= 25.1) return "Івано-Франківська область";
  if (lat >= 47.9 && lat <= 49.1 && lon >= 22.1 && lon <= 24.7) return "Закарпатська область";
  if (lat >= 47.7 && lat <= 48.7 && lon >= 24.9 && lon <= 26.5) return "Чернівецька область";
  if (lat >= 44.3 && lat <= 46.2 && lon >= 32.4 && lon <= 36.7) return "АР Крим";

  return "Україна";
}

export function isAlertActiveForRegion(regionName: string, activeAlerts: string[]): boolean {
  if (!regionName || activeAlerts.length === 0) return false;
  const regLower = regionName.toLowerCase();

  // 1. Direct contains check
  for (const alert of activeAlerts) {
    const aLower = alert.toLowerCase();
    if (aLower.includes(regLower) || regLower.includes(aLower)) {
      return true;
    }
  }

  // 2. Keyword stem matching
  for (const [, keywords] of Object.entries(OBLAST_KEYWORDS)) {
    const matchesRegion = keywords.some((kw) => regLower.includes(kw));
    if (matchesRegion) {
      const alertHit = activeAlerts.some((a) => {
        const aLow = a.toLowerCase();
        return keywords.some((kw) => aLow.includes(kw));
      });
      if (alertHit) return true;
    }
  }

  return false;
}

export function getLocationIntel(
  lat: number,
  lon: number,
  activeAlerts: string[],
  packets: TrackPacket[],
  scanRadiusKm = 60
): LocationIntel {
  const landmarkDesc = findNearestLandmark(lat, lon);
  const regionName = detectRegionFromCoordinates(lat, lon);
  const hasActiveAlert = isAlertActiveForRegion(regionName, activeAlerts);

  const now = Date.now();
  const nearbyThreats: NearbyThreat[] = [];

  for (const packet of packets) {
    const [id, type, pLat, pLon, heading, speed, timestamp, , , , altitude] = packet;
    const elapsedSeconds = Math.max(0, (now - timestamp) / 1000);

    // Dynamic predicted position
    const headingRad = (heading * Math.PI) / 180;
    const latRad = (pLat * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    const metersPerDegLat = 111139;
    const metersPerDegLon = metersPerDegLat * (cosLat > 0.05 ? cosLat : 0.05);

    const vxMps = Math.sin(headingRad) * speed;
    const vyMps = Math.cos(headingRad) * speed;

    const predLat = pLat + (vyMps * elapsedSeconds) / metersPerDegLat;
    const predLon = pLon + (vxMps * elapsedSeconds) / metersPerDegLon;

    const distMeters = haversineMeters({ lat: predLat, lon: predLon }, { lat, lon });
    const distKm = Math.round((distMeters / 1000) * 10) / 10;

    if (distKm <= scanRadiusKm) {
      const speedKmh = Math.round(speed * 3.6);
      const effectiveAltM =
        altitude !== undefined && altitude !== null
          ? Math.round(altitude)
          : type === "aircraft"
          ? 9800
          : type === "helicopter"
          ? 650
          : type === "munition"
          ? 95
          : 180;

      const spec = getTargetSpecification(type, id, speedKmh, effectiveAltM);
      const altAnalysis = getAltitudeAnalysis(effectiveAltM);

      // Bearing & radial approach check
      const bearingToLocation = bearingDegrees({ lat: predLat, lon: predLon }, { lat, lon });
      const angleDiff = Math.min(
        Math.abs(heading - bearingToLocation),
        360 - Math.abs(heading - bearingToLocation)
      );

      const isApproaching = angleDiff <= 55 && speed > 5;
      let etaMinutes: number | null = null;
      let etaSeconds: number | null = null;

      if (isApproaching) {
        const radialSpeed = speed * Math.cos((angleDiff * Math.PI) / 180);
        if (radialSpeed > 2) {
          const totalSec = Math.round(distMeters / radialSpeed);
          etaMinutes = Math.floor(totalSec / 60);
          etaSeconds = totalSec % 60;
        }
      }

      nearbyThreats.push({
        id,
        type,
        modelName: spec.modelName,
        distanceKm: distKm,
        altitudeM: effectiveAltM,
        flightLevel: altAnalysis.flightLevel,
        speedKmh,
        heading,
        isApproaching,
        etaMinutes,
        etaSeconds,
        corridorBadgeColor: altAnalysis.corridorBadgeColor
      });
    }
  }

  // Sort by distance (nearest first)
  nearbyThreats.sort((a, b) => a.distanceKm - b.distanceKm);

  const closestThreat = nearbyThreats.length > 0 ? nearbyThreats[0] : null;

  let alertTypeDesc = "Обстановка спокійна";
  let summaryStatus: "CRITICAL" | "WARNING" | "CLEAR" = "CLEAR";

  if (hasActiveAlert) {
    if (closestThreat && (closestThreat.type === "uav" || closestThreat.type === "munition") && closestThreat.distanceKm < 35) {
      summaryStatus = "CRITICAL";
      alertTypeDesc = closestThreat.type === "uav" ? "Загроза ударних БПЛА (Шахед) у секторі" : "Ракетна небезпека / Швидкісна ціль";
    } else {
      summaryStatus = "WARNING";
      alertTypeDesc = "Повітряна тривога в області";
    }
  } else if (closestThreat && closestThreat.distanceKm < 30 && (closestThreat.type === "uav" || closestThreat.type === "munition")) {
    summaryStatus = "WARNING";
    alertTypeDesc = "Виявлено повітряну ціль поруч (без сирен тривоги)";
  }

  return {
    lat,
    lon,
    landmarkDesc,
    regionName,
    hasActiveAlert,
    alertTypeDesc,
    nearbyThreats,
    closestThreat,
    summaryStatus
  };
}
