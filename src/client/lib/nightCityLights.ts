// Realistic Night Urban & Highway Illumination Engine
// Renders authentic NASA VIIRS / Earth-at-Night style ambient city glow and arterial transport corridors
// across genuine Ukrainian population centers and highways at night.
// Clean, performant, no artificial random noise: preserves military cartographic realism.

import type { Map } from "maplibre-gl";

export interface CityCentroid {
  name: string;
  lon: number;
  lat: number;
  radiusKm: number;
  intensity: number;
}

// All 24 oblast centers + Crimea + key industrial and transport hubs of Ukraine
export const CITY_NIGHT_CENTROIDS: CityCentroid[] = [
  // Major Metropolises
  { name: "Київ", lon: 30.5234, lat: 50.4501, radiusKm: 26, intensity: 0.98 },
  { name: "Харків", lon: 36.2304, lat: 49.9935, radiusKm: 20, intensity: 0.92 },
  { name: "Одеса", lon: 30.7233, lat: 46.4825, radiusKm: 18, intensity: 0.90 },
  { name: "Дніпро", lon: 35.0462, lat: 48.4647, radiusKm: 19, intensity: 0.90 },
  { name: "Львів", lon: 24.0297, lat: 49.8397, radiusKm: 17, intensity: 0.88 },
  { name: "Запоріжжя", lon: 35.1396, lat: 47.8388, radiusKm: 16, intensity: 0.85 },
  { name: "Кривий Ріг", lon: 33.3918, lat: 47.9105, radiusKm: 18, intensity: 0.84 },

  // Regional Capitals
  { name: "Вінниця", lon: 28.4682, lat: 49.2331, radiusKm: 12, intensity: 0.78 },
  { name: "Полтава", lon: 34.5514, lat: 49.5883, radiusKm: 12, intensity: 0.78 },
  { name: "Чернігів", lon: 31.2893, lat: 51.4982, radiusKm: 11, intensity: 0.75 },
  { name: "Черкаси", lon: 32.0598, lat: 49.4444, radiusKm: 12, intensity: 0.76 },
  { name: "Житомир", lon: 28.6587, lat: 50.2547, radiusKm: 11, intensity: 0.76 },
  { name: "Суми", lon: 34.7981, lat: 50.9077, radiusKm: 11, intensity: 0.74 },
  { name: "Миколаїв", lon: 31.9946, lat: 46.975, radiusKm: 13, intensity: 0.78 },
  { name: "Хмельницький", lon: 26.9871, lat: 49.423, radiusKm: 10, intensity: 0.74 },
  { name: "Рівне", lon: 26.2516, lat: 50.6199, radiusKm: 10, intensity: 0.74 },
  { name: "Івано-Франківськ", lon: 24.7111, lat: 48.9226, radiusKm: 10, intensity: 0.74 },
  { name: "Тернопіль", lon: 25.5948, lat: 49.5535, radiusKm: 10, intensity: 0.72 },
  { name: "Луцьк", lon: 25.3254, lat: 50.7472, radiusKm: 10, intensity: 0.72 },
  { name: "Ужгород", lon: 22.2879, lat: 48.6208, radiusKm: 8, intensity: 0.68 },
  { name: "Чернівці", lon: 25.9352, lat: 48.2917, radiusKm: 9, intensity: 0.70 },
  { name: "Херсон", lon: 32.6169, lat: 46.6354, radiusKm: 11, intensity: 0.72 },
  { name: "Кропивницький", lon: 32.2623, lat: 48.5079, radiusKm: 10, intensity: 0.72 },

  // Industrial & Strategic Centers
  { name: "Кременчук", lon: 33.404, lat: 49.063, radiusKm: 10, intensity: 0.75 },
  { name: "Біла Церква", lon: 30.1153, lat: 49.7989, radiusKm: 9, intensity: 0.70 },
  { name: "Кам'янське", lon: 34.609, lat: 48.513, radiusKm: 11, intensity: 0.75 },
  { name: "Павлоград", lon: 35.870, lat: 48.526, radiusKm: 9, intensity: 0.70 },
  { name: "Нікополь", lon: 34.397, lat: 47.567, radiusKm: 8, intensity: 0.65 },
  { name: "Краматорськ", lon: 37.584, lat: 48.739, radiusKm: 10, intensity: 0.68 },
  { name: "Слов'янськ", lon: 37.616, lat: 48.871, radiusKm: 9, intensity: 0.66 },
  { name: "Мукачево", lon: 22.717, lat: 48.441, radiusKm: 8, intensity: 0.68 },
  { name: "Дрогобич", lon: 23.506, lat: 49.354, radiusKm: 8, intensity: 0.65 },
  { name: "Умань", lon: 30.222, lat: 48.749, radiusKm: 8, intensity: 0.66 },
  { name: "Конотоп", lon: 33.203, lat: 51.242, radiusKm: 8, intensity: 0.64 },
  { name: "Шостка", lon: 33.486, lat: 51.863, radiusKm: 7, intensity: 0.62 },
  { name: "Бровари", lon: 30.791, lat: 50.511, radiusKm: 8, intensity: 0.72 },
  { name: "Бориспіль", lon: 30.952, lat: 50.354, radiusKm: 8, intensity: 0.72 },

  // South & Crimea
  { name: "Мелітополь", lon: 35.367, lat: 46.848, radiusKm: 10, intensity: 0.68 },
  { name: "Бердянськ", lon: 36.786, lat: 46.755, radiusKm: 9, intensity: 0.68 },
  { name: "Маріуполь", lon: 37.555, lat: 47.095, radiusKm: 13, intensity: 0.72 },
  { name: "Севастополь", lon: 33.5254, lat: 44.6167, radiusKm: 13, intensity: 0.78 },
  { name: "Сімферополь", lon: 34.1024, lat: 44.9521, radiusKm: 13, intensity: 0.78 }
];

/**
 * Renders realistic, soft ambient urban night light bloom across Ukrainian population centers.
 * Seamlessly scales with zoom: authentic NASA Black Marble warm golden radiance.
 * No synthetic lines, no fake spokes. Real roads and streets are rendered by the cartographic map layer.
 */
export const drawNightCityLights = (
  ctx: CanvasRenderingContext2D,
  map: Map,
  nightFactor: number, // 0.0 (day) to 1.0 (deep night)
  _timeMs: number,
  width: number,
  height: number
) => {
  if (nightFactor <= 0.04) return;

  const zoom = map.getZoom();

  ctx.save();

  for (const city of CITY_NIGHT_CENTROIDS) {
    const pt = map.project([city.lon, city.lat]);
    if (pt.x < -160 || pt.x > width + 160 || pt.y < -160 || pt.y > height + 160) {
      continue;
    }

    // Dynamic zoom-scaling without sudden hard cutoffs
    // At low zoom (4-7), halo covers regional area; at high zoom (8-14), halo expands naturally into metropolitan glow
    const scaleFactor = Math.max(0.5, (zoom / 6.0) ** 1.3);
    const haloRadius = Math.min(140, Math.max(8, (city.radiusKm / 2.8) * scaleFactor));

    // Authentic warm golden-amber city bloom
    const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, haloRadius);
    grad.addColorStop(0, `rgba(254, 240, 138, ${(0.48 * city.intensity * nightFactor).toFixed(3)})`);
    grad.addColorStop(0.30, `rgba(245, 158, 11, ${(0.26 * city.intensity * nightFactor).toFixed(3)})`);
    grad.addColorStop(0.65, `rgba(217, 119, 6, ${(0.10 * city.intensity * nightFactor).toFixed(3)})`);
    grad.addColorStop(1, "rgba(217, 119, 6, 0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, haloRadius, 0, Math.PI * 2);
    ctx.fill();

    // Luminous downtown core node at zoom >= 6.5
    if (zoom >= 6.5) {
      const coreR = Math.max(3, Math.min(22, haloRadius * 0.16));
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, coreR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.55 * city.intensity * nightFactor).toFixed(3)})`;
      ctx.fill();
    }
  }

  ctx.restore();
};


