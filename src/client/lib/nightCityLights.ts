// Autonomous Night Illumination Engine: Ukrainian Cities & Highway Networks
// Renders live glowing cities, streetlights, and traffic arteries at night

import type { Map } from "maplibre-gl";

export interface HighwayArtery {
  code: string;
  name: string;
  waypoints: Array<[number, number]>; // [lon, lat]
}

// Major strategic highway corridors connecting Ukraine's population centers
export const MAJOR_HIGHWAYS: HighwayArtery[] = [
  // M-03: Kyiv -> Boryspil -> Pyriatyn -> Lubny -> Poltava -> Kharkiv -> Chuhuiv
  {
    code: "M-03",
    name: "Київ - Харків",
    waypoints: [
      [30.5234, 50.4501], [30.9576, 50.3524], [31.78, 50.32],
      [32.50, 50.24], [32.9996, 50.0153], [33.6121, 49.9658],
      [34.5514, 49.5883], [35.25, 49.75], [36.2304, 49.9935], [36.65, 49.83]
    ]
  },
  // M-05: Kyiv -> Vasylkiv -> Bila Tserkva -> Zhashkiv -> Uman -> Odesa
  {
    code: "M-05",
    name: "Київ - Одеса",
    waypoints: [
      [30.5234, 50.4501], [30.3168, 50.1772], [30.1153, 49.7989],
      [30.10, 49.25], [30.2218, 48.7484], [30.25, 47.95],
      [30.35, 47.35], [30.50, 46.85], [30.7233, 46.4825]
    ]
  },
  // M-06: Kyiv -> Zhytomyr -> Zvyagel -> Rivne -> Dubno -> Brody -> Lviv -> Stryi -> Uzhhorod
  {
    code: "M-06",
    name: "Київ - Чоп / Львів",
    waypoints: [
      [30.5234, 50.4501], [29.9171, 50.0784], [28.6587, 50.2547],
      [27.6253, 50.5878], [26.2516, 50.6199], [25.7347, 50.4187],
      [25.15, 50.08], [24.0297, 49.8397], [23.85, 49.25],
      [23.20, 48.65], [22.2879, 48.6208]
    ]
  },
  // H-08 / M-30: Kyiv -> Kaniv -> Cherkasy -> Kremenchuk -> Dnipro -> Zaporizhzhia
  {
    code: "H-08",
    name: "Київ - Дніпро - Запоріжжя",
    waypoints: [
      [30.5234, 50.4501], [30.6276, 50.1264], [31.8706, 49.2319],
      [32.0598, 49.4444], [33.404, 49.063], [34.65, 48.65],
      [35.0462, 48.4647], [35.1396, 47.8388]
    ]
  },
  // M-01: Kyiv -> Brovary -> Kozelets -> Chernihiv
  {
    code: "M-01",
    name: "Київ - Чернігів",
    waypoints: [
      [30.5234, 50.4501], [30.7902, 50.5114], [31.11, 50.91],
      [31.2893, 51.4982]
    ]
  },
  // H-07 / H-12: Kyiv -> Pryluky -> Romny -> Sumy -> Kharkiv
  {
    code: "H-07",
    name: "Київ - Суми - Харків",
    waypoints: [
      [30.5234, 50.4501], [31.8845, 51.0485], [32.3872, 50.5904],
      [33.4862, 50.75], [34.7981, 50.9077], [35.15, 50.45],
      [36.2304, 49.9935]
    ]
  },
  // M-04: Dnipro -> Kryvyi Rih -> Kropyvnytskyi -> Uman
  {
    code: "M-04",
    name: "Дніпро - Кривий Ріг",
    waypoints: [
      [35.0462, 48.4647], [33.3918, 47.9105], [32.25, 48.51],
      [30.2218, 48.7484]
    ]
  },
  // M-14: Odesa -> Mykolaiv -> Kherson
  {
    code: "M-14",
    name: "Одеса - Миколаїв - Херсон",
    waypoints: [
      [30.7233, 46.4825], [31.9946, 46.975], [32.6178, 46.6354]
    ]
  }
];

// Major city night lights definitions: [lon, lat, radiusKm, intensity, clusterCount]
export const CITY_NIGHT_CENTROIDS: Array<{
  name: string;
  lon: number;
  lat: number;
  radiusKm: number;
  intensity: number;
  clusterCount: number;
}> = [
  { name: "Київ", lon: 30.5234, lat: 50.4501, radiusKm: 22, intensity: 1.0, clusterCount: 45 },
  { name: "Харків", lon: 36.2304, lat: 49.9935, radiusKm: 18, intensity: 0.92, clusterCount: 36 },
  { name: "Одеса", lon: 30.7233, lat: 46.4825, radiusKm: 16, intensity: 0.90, clusterCount: 32 },
  { name: "Дніпро", lon: 35.0462, lat: 48.4647, radiusKm: 17, intensity: 0.90, clusterCount: 34 },
  { name: "Львів", lon: 24.0297, lat: 49.8397, radiusKm: 15, intensity: 0.88, clusterCount: 30 },
  { name: "Запоріжжя", lon: 35.1396, lat: 47.8388, radiusKm: 14, intensity: 0.85, clusterCount: 26 },
  { name: "Кривий Ріг", lon: 33.3918, lat: 47.9105, radiusKm: 18, intensity: 0.82, clusterCount: 28 },
  { name: "Вінниця", lon: 28.4682, lat: 49.2331, radiusKm: 10, intensity: 0.78, clusterCount: 20 },
  { name: "Полтава", lon: 34.5514, lat: 49.5883, radiusKm: 10, intensity: 0.78, clusterCount: 20 },
  { name: "Чернігів", lon: 31.2893, lat: 51.4982, radiusKm: 9, intensity: 0.75, clusterCount: 18 },
  { name: "Черкаси", lon: 32.0598, lat: 49.4444, radiusKm: 10, intensity: 0.75, clusterCount: 18 },
  { name: "Житомир", lon: 28.6587, lat: 50.2547, radiusKm: 9, intensity: 0.75, clusterCount: 18 },
  { name: "Суми", lon: 34.7981, lat: 50.9077, radiusKm: 9, intensity: 0.72, clusterCount: 16 },
  { name: "Миколаїв", lon: 31.9946, lat: 46.975, radiusKm: 11, intensity: 0.75, clusterCount: 20 },
  { name: "Хмельницький", lon: 26.9871, lat: 49.423, radiusKm: 8, intensity: 0.72, clusterCount: 16 },
  { name: "Рівне", lon: 26.2516, lat: 50.6199, radiusKm: 8, intensity: 0.72, clusterCount: 16 },
  { name: "Івано-Франківськ", lon: 24.7111, lat: 48.9226, radiusKm: 8, intensity: 0.72, clusterCount: 16 },
  { name: "Тернопіль", lon: 25.5948, lat: 49.5535, radiusKm: 8, intensity: 0.70, clusterCount: 15 },
  { name: "Луцьк", lon: 25.3254, lat: 50.7472, radiusKm: 8, intensity: 0.70, clusterCount: 15 },
  { name: "Кременчук", lon: 33.404, lat: 49.063, radiusKm: 8, intensity: 0.72, clusterCount: 16 },
  { name: "Біла Церква", lon: 30.1153, lat: 49.7989, radiusKm: 7, intensity: 0.68, clusterCount: 14 },
  { name: "Ужгород", lon: 22.2879, lat: 48.6208, radiusKm: 6, intensity: 0.65, clusterCount: 12 },
  { name: "Чернівці", lon: 25.9352, lat: 48.2917, radiusKm: 7, intensity: 0.68, clusterCount: 14 }
];

/**
 * Renders glowing city night lights, highway arteries, and streetlight nodes
 */
export const drawNightCityLights = (
  ctx: CanvasRenderingContext2D,
  map: Map,
  nightFactor: number, // 0.0 (day) to 1.0 (deep night)
  timeMs: number,
  width: number,
  height: number
) => {
  if (nightFactor <= 0.05) return;

  const zoom = map.getZoom();
  ctx.save();

  // 1. Highway Logistics Arteries (Warm glowing road network veins)
  for (const highway of MAJOR_HIGHWAYS) {
    const pts = highway.waypoints.map((coord) => map.project(coord));

    // Check if any point is on screen
    const visible = pts.some((p) => p.x >= -50 && p.x <= width + 50 && p.y >= -50 && p.y <= height + 50);
    if (!visible) continue;

    ctx.save();
    // Base warm road line
    const roadWidth = zoom >= 10 ? 2.8 : zoom >= 7 ? 1.8 : 1.1;
    ctx.lineWidth = roadWidth;
    ctx.strokeStyle = `rgba(245, 158, 11, ${0.28 * nightFactor})`;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();

    // Secondary subtle road glow
    if (zoom >= 6.5) {
      ctx.lineWidth = roadWidth * 2.5;
      ctx.strokeStyle = `rgba(251, 191, 36, ${0.12 * nightFactor})`;
      ctx.stroke();
    }

    // Moving night traffic pulse (simulating real vehicle headlights on arteries)
    const trafficPulse = (timeMs / 2500) % 1;
    const totalSegments = pts.length - 1;
    const activeSegIdx = Math.floor(trafficPulse * totalSegments);
    const segT = (trafficPulse * totalSegments) % 1;

    if (activeSegIdx < totalSegments) {
      const pA = pts[activeSegIdx];
      const pB = pts[activeSegIdx + 1];
      const pulseX = pA.x + (pB.x - pA.x) * segT;
      const pulseY = pA.y + (pB.y - pA.y) * segT;

      ctx.beginPath();
      ctx.arc(pulseX, pulseY, zoom >= 9 ? 3.5 : 2.0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(254, 240, 138, ${0.75 * nightFactor})`;
      ctx.fill();
    }
    ctx.restore();
  }

  // 2. City Night Lights Halos & Streetlight Grids
  for (const city of CITY_NIGHT_CENTROIDS) {
    const pt = map.project([city.lon, city.lat]);
    if (pt.x < -150 || pt.x > width + 150 || pt.y < -150 || pt.y > height + 150) {
      continue;
    }

    const scaleFactor = Math.max(1, (zoom / 6.0) ** 1.3);
    const haloRadius = Math.min(85, (city.radiusKm / 3) * scaleFactor);

    // Warm radial urban illumination glow
    const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, haloRadius);
    grad.addColorStop(0, `rgba(253, 224, 71, ${0.45 * city.intensity * nightFactor})`);
    grad.addColorStop(0.35, `rgba(245, 158, 11, ${0.25 * city.intensity * nightFactor})`);
    grad.addColorStop(0.75, `rgba(217, 119, 6, ${0.08 * city.intensity * nightFactor})`);
    grad.addColorStop(1, "rgba(217, 119, 6, 0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, haloRadius, 0, Math.PI * 2);
    ctx.fill();

    // Central bright downtown core
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, Math.max(2, haloRadius * 0.15), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(254, 252, 232, ${0.65 * city.intensity * nightFactor})`;
    ctx.fill();

    // 3. Realistic Streetlight Grid Nodes (Flickering street lamps at zoom >= 7.0)
    if (zoom >= 7.0) {
      const clusterRadius = haloRadius * 0.75;
      const count = Math.min(city.clusterCount, zoom >= 10 ? city.clusterCount : 15);

      for (let i = 0; i < count; i++) {
        // Deterministic pseudo-random distribution around city center
        const angle = (i * 137.5 * Math.PI) / 180;
        const rNorm = Math.sqrt((i + 1) / count);
        const dist = rNorm * clusterRadius;
        const lx = pt.x + Math.cos(angle) * dist;
        const ly = pt.y + Math.sin(angle) * dist;

        // Micro lamp twinkle
        const lampTwinkle = Math.sin(timeMs / 200 + i * 2.1) * 0.25 + 0.75;
        const lampSize = zoom >= 11 ? 2.5 : zoom >= 9 ? 1.8 : 1.2;

        ctx.fillStyle = `rgba(254, 240, 138, ${0.72 * lampTwinkle * nightFactor})`;
        ctx.fillRect(lx - lampSize / 2, ly - lampSize / 2, lampSize, lampSize);
      }
    }
  }

  ctx.restore();
};
