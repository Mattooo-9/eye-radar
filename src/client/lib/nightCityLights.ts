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

// Arterial Highway Corridors of Ukraine (Authentic National Road Network)
export const UKRAINE_NIGHT_HIGHWAYS: Array<{
  name: string;
  points: Array<[number, number]>; // [lon, lat]
}> = [
  // M-03: Київ — Бориспіль — Пирятин — Лубни — Полтава — Харків — Слов'янськ
  {
    name: "M-03",
    points: [
      [30.523, 50.450],
      [30.952, 50.354],
      [31.775, 50.252],
      [32.508, 50.247],
      [33.003, 50.016],
      [33.256, 49.782],
      [34.551, 49.588],
      [35.617, 49.837],
      [36.230, 49.993],
      [36.685, 49.835],
      [37.284, 49.208],
      [37.616, 48.871]
    ]
  },
  // M-05: Київ — Біла Церква — Умань — Любашівка — Одеса
  {
    name: "M-05",
    points: [
      [30.523, 50.450],
      [30.320, 50.178],
      [30.115, 49.799],
      [30.108, 49.243],
      [30.222, 48.749],
      [30.231, 48.281],
      [30.260, 47.863],
      [30.450, 47.280],
      [30.723, 46.482]
    ]
  },
  // M-06: Київ — Житомир — Новоград-Волинський — Рівне — Львів — Стрий — Мукачево — Чоп
  {
    name: "M-06",
    points: [
      [30.523, 50.450],
      [29.814, 50.463],
      [29.231, 50.495],
      [29.060, 50.318],
      [28.658, 50.254],
      [27.632, 50.589],
      [27.161, 50.617],
      [26.251, 50.619],
      [25.736, 50.418],
      [25.148, 50.084],
      [24.620, 49.970],
      [24.029, 49.839],
      [23.857, 49.256],
      [23.513, 49.035],
      [22.986, 48.547],
      [22.717, 48.441],
      [22.287, 48.620],
      [22.208, 48.432]
    ]
  },
  // M-30: Стрий — Тернопіль — Хмельницький — Вінниця — Умань — Кропивницький — Дніпро — Покровськ
  {
    name: "M-30",
    points: [
      [23.857, 49.256],
      [24.611, 49.412],
      [24.935, 49.444],
      [25.594, 49.553],
      [26.138, 49.530],
      [26.987, 49.423],
      [27.625, 49.387],
      [28.468, 49.233],
      [28.847, 48.977],
      [29.386, 48.810],
      [30.222, 48.749],
      [30.824, 48.665],
      [32.262, 48.507],
      [32.673, 48.711],
      [33.116, 48.670],
      [33.714, 48.415],
      [34.609, 48.513],
      [35.046, 48.464],
      [35.228, 48.643],
      [35.870, 48.526],
      [37.175, 48.282]
    ]
  },
  // M-14: Одеса — Миколаїв — Херсон — Мелітополь — Бердянськ — Маріуполь
  {
    name: "M-14",
    points: [
      [30.723, 46.482],
      [31.100, 46.621],
      [31.209, 46.662],
      [31.994, 46.975],
      [32.616, 46.635],
      [32.724, 46.620],
      [33.488, 46.812],
      [35.367, 46.848],
      [36.347, 46.734],
      [36.786, 46.755],
      [37.555, 47.095]
    ]
  },
  // H-08: Бориспіль — Переяслав — Золотоноша — Черкаси — Кременчук — Кам'янське — Дніпро — Запоріжжя
  {
    name: "H-08",
    points: [
      [30.952, 50.354],
      [31.446, 50.065],
      [32.046, 49.668],
      [32.059, 49.444],
      [32.664, 49.125],
      [33.227, 49.052],
      [33.404, 49.063],
      [34.609, 48.513],
      [35.046, 48.464],
      [35.139, 47.838]
    ]
  },
  // M-18 / M-29: Харків — Красноград — Новомосковськ — Дніпро — Запоріжжя — Мелітополь
  {
    name: "M-18",
    points: [
      [36.230, 49.993],
      [36.059, 49.821],
      [35.456, 49.373],
      [35.358, 49.014],
      [35.228, 48.643],
      [35.046, 48.464],
      [35.139, 47.838],
      [35.276, 47.439],
      [35.367, 46.848]
    ]
  },
  // M-01: Київ — Бровари — Козелець — Чернігів
  {
    name: "M-01",
    points: [
      [30.523, 50.450],
      [30.791, 50.511],
      [31.114, 50.914],
      [31.289, 51.498],
      [31.083, 51.801]
    ]
  },
  // M-07: Київ — Бородянка — Коростень — Олевськ — Сарни — Ковель — Ягодин
  {
    name: "M-07",
    points: [
      [30.523, 50.450],
      [30.264, 50.569],
      [29.923, 50.645],
      [29.243, 50.769],
      [28.648, 50.949],
      [27.652, 51.226],
      [27.215, 51.280],
      [26.606, 51.336],
      [25.549, 51.295],
      [24.709, 51.221],
      [24.053, 51.224],
      [23.791, 51.202]
    ]
  },
  // M-19: Луцьк — Дубно — Тернопіль — Чортків — Чернівці
  {
    name: "M-19",
    points: [
      [25.325, 50.747],
      [25.736, 50.418],
      [25.727, 50.103],
      [25.594, 49.553],
      [25.719, 49.299],
      [25.797, 49.016],
      [25.734, 48.646],
      [25.935, 48.291]
    ]
  },
  // H-09/H-10: Львів — Івано-Франківськ — Коломия — Чернівці
  {
    name: "H-09",
    points: [
      [24.029, 49.839],
      [24.296, 49.638],
      [24.611, 49.412],
      [24.711, 48.922],
      [24.847, 48.903],
      [25.040, 48.530],
      [25.567, 48.448],
      [25.935, 48.291]
    ]
  }
];

/**
 * Draws illuminated highway ribbons across Ukraine, matching NASA Black Marble night lighting.
 */
function drawNightHighways(
  ctx: CanvasRenderingContext2D,
  map: Map,
  nightFactor: number,
  zoom: number,
  _width: number,
  _height: number
) {
  if (zoom < 4.5) return;

  const glowWidth = Math.max(2.2, Math.min(8.5, (zoom - 4.0) * 1.1));
  const coreWidth = Math.max(0.9, Math.min(3.2, (zoom - 4.0) * 0.42));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Tier 1: Soft warm ambient highway glow
  ctx.strokeStyle = `rgba(245, 158, 11, ${(0.14 * nightFactor).toFixed(3)})`;
  ctx.lineWidth = glowWidth;

  for (const highway of UKRAINE_NIGHT_HIGHWAYS) {
    let started = false;
    ctx.beginPath();
    for (const [lon, lat] of highway.points) {
      const pt = map.project([lon, lat]);
      if (!started) {
        ctx.moveTo(pt.x, pt.y);
        started = true;
      } else {
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.stroke();
  }

  // Tier 2: Core luminous filament (vehicle traffic and road streetlights)
  ctx.strokeStyle = `rgba(254, 240, 138, ${(0.28 * nightFactor).toFixed(3)})`;
  ctx.lineWidth = coreWidth;

  for (const highway of UKRAINE_NIGHT_HIGHWAYS) {
    let started = false;
    ctx.beginPath();
    for (const [lon, lat] of highway.points) {
      const pt = map.project([lon, lat]);
      if (!started) {
        ctx.moveTo(pt.x, pt.y);
        started = true;
      } else {
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Renders realistic, soft ambient urban night light bloom and arterial highways.
 * Seamlessly scales from orbital view down to street level without artificial cutoffs.
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

  // 1. Draw connecting highway ribbons first (underneath city light nodes)
  drawNightHighways(ctx, map, nightFactor, zoom, width, height);

  ctx.save();

  // 2. Draw living city light nodes
  for (const city of CITY_NIGHT_CENTROIDS) {
    const pt = map.project([city.lon, city.lat]);
    // Generous culling padding
    if (pt.x < -160 || pt.x > width + 160 || pt.y < -160 || pt.y > height + 160) {
      continue;
    }

    // Dynamic zoom-scaling without sudden hard cutoffs
    // At low zoom (4-7), halo covers regional area; at high zoom (8-14), halo expands naturally into metropolitan glow
    const scaleFactor = Math.max(0.5, (zoom / 6.0) ** 1.3);
    const haloRadius = Math.min(140, Math.max(8, (city.radiusKm / 2.8) * scaleFactor));

    // Authentic warm golden-amber city bloom
    const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, haloRadius);
    grad.addColorStop(0, `rgba(254, 240, 138, ${(0.42 * city.intensity * nightFactor).toFixed(3)})`);
    grad.addColorStop(0.30, `rgba(245, 158, 11, ${(0.22 * city.intensity * nightFactor).toFixed(3)})`);
    grad.addColorStop(0.65, `rgba(217, 119, 6, ${(0.08 * city.intensity * nightFactor).toFixed(3)})`);
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
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.52 * city.intensity * nightFactor).toFixed(3)})`;
      ctx.fill();
    }
  }

  ctx.restore();
};

