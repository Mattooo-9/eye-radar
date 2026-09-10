// Realistic Night Urban Illumination Engine
// Renders subtle, realistic ambient city glow over genuine Ukrainian population centers at night
// No artificial straight lines or synthetic fireflies: preserves pure cartographic realism.

import type { Map } from "maplibre-gl";

// Major city centroids with geographic coordinates and urban radii
export const CITY_NIGHT_CENTROIDS: Array<{
  name: string;
  lon: number;
  lat: number;
  radiusKm: number;
  intensity: number;
}> = [
  { name: "Київ", lon: 30.5234, lat: 50.4501, radiusKm: 24, intensity: 0.95 },
  { name: "Харків", lon: 36.2304, lat: 49.9935, radiusKm: 18, intensity: 0.90 },
  { name: "Одеса", lon: 30.7233, lat: 46.4825, radiusKm: 16, intensity: 0.88 },
  { name: "Дніпро", lon: 35.0462, lat: 48.4647, radiusKm: 17, intensity: 0.88 },
  { name: "Львів", lon: 24.0297, lat: 49.8397, radiusKm: 15, intensity: 0.85 },
  { name: "Запоріжжя", lon: 35.1396, lat: 47.8388, radiusKm: 14, intensity: 0.82 },
  { name: "Кривий Ріг", lon: 33.3918, lat: 47.9105, radiusKm: 16, intensity: 0.80 },
  { name: "Вінниця", lon: 28.4682, lat: 49.2331, radiusKm: 10, intensity: 0.75 },
  { name: "Полтава", lon: 34.5514, lat: 49.5883, radiusKm: 10, intensity: 0.75 },
  { name: "Чернігів", lon: 31.2893, lat: 51.4982, radiusKm: 9, intensity: 0.72 },
  { name: "Черкаси", lon: 32.0598, lat: 49.4444, radiusKm: 10, intensity: 0.72 },
  { name: "Житомир", lon: 28.6587, lat: 50.2547, radiusKm: 9, intensity: 0.72 },
  { name: "Суми", lon: 34.7981, lat: 50.9077, radiusKm: 9, intensity: 0.70 },
  { name: "Миколаїв", lon: 31.9946, lat: 46.975, radiusKm: 11, intensity: 0.75 },
  { name: "Хмельницький", lon: 26.9871, lat: 49.423, radiusKm: 8, intensity: 0.70 },
  { name: "Рівне", lon: 26.2516, lat: 50.6199, radiusKm: 8, intensity: 0.70 },
  { name: "Івано-Франківськ", lon: 24.7111, lat: 48.9226, radiusKm: 8, intensity: 0.70 },
  { name: "Тернопіль", lon: 25.5948, lat: 49.5535, radiusKm: 8, intensity: 0.68 },
  { name: "Луцьк", lon: 25.3254, lat: 50.7472, radiusKm: 8, intensity: 0.68 },
  { name: "Кременчук", lon: 33.404, lat: 49.063, radiusKm: 8, intensity: 0.70 },
  { name: "Біла Церква", lon: 30.1153, lat: 49.7989, radiusKm: 7, intensity: 0.65 },
  { name: "Ужгород", lon: 22.2879, lat: 48.6208, radiusKm: 6, intensity: 0.62 },
  { name: "Чернівці", lon: 25.9352, lat: 48.2917, radiusKm: 7, intensity: 0.65 },
  { name: "Херсон", lon: 32.6169, lat: 46.6354, radiusKm: 9, intensity: 0.68 },
  { name: "Кропивницький", lon: 32.2623, lat: 48.5079, radiusKm: 8, intensity: 0.68 },
  { name: "Севастополь", lon: 33.5254, lat: 44.6167, radiusKm: 11, intensity: 0.75 }
];

/**
 * Renders realistic, soft ambient urban night light bloom on city centroids.
 * Strictly avoids synthetic lines or moving dots to maintain true-to-life military cartography.
 */
export const drawNightCityLights = (
  ctx: CanvasRenderingContext2D,
  map: Map,
  nightFactor: number, // 0.0 (day) to 1.0 (deep night)
  _timeMs: number,
  width: number,
  height: number
) => {
  if (nightFactor <= 0.05) return;

  const zoom = map.getZoom();
  // Regional city bloom is only relevant on regional view; skip at local zoom to save GPU
  if (zoom > 8.0) return;

  ctx.save();

  // Natural radial urban illumination glow
  for (const city of CITY_NIGHT_CENTROIDS) {
    const pt = map.project([city.lon, city.lat]);
    if (pt.x < -120 || pt.x > width + 120 || pt.y < -120 || pt.y > height + 120) {
      continue;
    }

    // Scale glow appropriately with map zoom level
    const scaleFactor = Math.max(0.6, (zoom / 6.0) ** 1.15);
    const haloRadius = Math.min(65, (city.radiusKm / 3.2) * scaleFactor);

    if (haloRadius < 3) continue;

    // Authentic warm amber city bloom (no cartoonish dots)
    const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, haloRadius);
    grad.addColorStop(0, `rgba(254, 240, 138, ${0.38 * city.intensity * nightFactor})`);
    grad.addColorStop(0.35, `rgba(245, 158, 11, ${0.18 * city.intensity * nightFactor})`);
    grad.addColorStop(0.7, `rgba(217, 119, 6, ${0.06 * city.intensity * nightFactor})`);
    grad.addColorStop(1, "rgba(217, 119, 6, 0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, haloRadius, 0, Math.PI * 2);
    ctx.fill();

    // Subtle bright downtown core at zoom >= 7
    if (zoom >= 7.0) {
      const coreR = Math.max(2, haloRadius * 0.12);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, coreR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.45 * city.intensity * nightFactor})`;
      ctx.fill();
    }
  }

  ctx.restore();
};
