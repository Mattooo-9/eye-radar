import { haversineMeters, bearingDegrees } from "./geo";

interface Landmark {
  name: string;
  lat: number;
  lon: number;
  region?: string;
}

const LANDMARKS: Landmark[] = [
  // Major Ukrainian Cities & Strategic Hubs
  { name: "Київ", lat: 50.4501, lon: 30.5234, region: "Київська обл." },
  { name: "Харків", lat: 49.9935, lon: 36.2304, region: "Харківська обл." },
  { name: "Одеса", lat: 46.4825, lon: 30.7233, region: "Одеська обл." },
  { name: "Дніпро", lat: 48.4647, lon: 35.0462, region: "Дніпропетровська обл." },
  { name: "Львів", lat: 49.8397, lon: 24.0297, region: "Львівська обл." },
  { name: "Запоріжжя", lat: 47.8388, lon: 35.1396, region: "Запорізька обл." },
  { name: "Вінниця", lat: 49.2331, lon: 28.4682, region: "Вінницька обл." },
  { name: "Полтава", lat: 49.5883, lon: 34.5514, region: "Полтавська обл." },
  { name: "Чернігів", lat: 51.4982, lon: 31.2893, region: "Чернігівська обл." },
  { name: "Черкаси", lat: 49.4444, lon: 32.0598, region: "Черкаська обл." },
  { name: "Житомир", lat: 50.2547, lon: 28.6587, region: "Житомирська обл." },
  { name: "Суми", lat: 50.9077, lon: 34.7981, region: "Сумська обл." },
  { name: "Хмельницький", lat: 49.423, lon: 26.9871, region: "Хмельницька обл." },
  { name: "Чернівці", lat: 48.2917, lon: 25.9352, region: "Чернівецька обл." },
  { name: "Рівне", lat: 50.6199, lon: 26.2516, region: "Рівненська обл." },
  { name: "Івано-Франківськ", lat: 48.9226, lon: 24.7111, region: "Івано-Франківська обл." },
  { name: "Кременчук", lat: 49.063, lon: 33.404, region: "Полтавська обл." },
  { name: "Тернопіль", lat: 49.5535, lon: 25.5948, region: "Тернопільська обл." },
  { name: "Луцьк", lat: 50.7472, lon: 25.3254, region: "Волинська обл." },
  { name: "Ужгород", lat: 48.6208, lon: 22.2879, region: "Закарпатська обл." },
  { name: "Кривий Ріг", lat: 47.9105, lon: 33.3918, region: "Дніпропетровська обл." },
  { name: "Миколаїв", lat: 46.975, lon: 31.9946, region: "Миколаївська обл." },
  { name: "Умань", lat: 48.7484, lon: 30.2218, region: "Черкаська обл." },
  { name: "Біла Церква", lat: 49.7989, lon: 30.1153, region: "Київська обл." },
  { name: "Ізмаїл", lat: 45.3507, lon: 28.8398, region: "Одеська обл." },
  { name: "Конотоп", lat: 51.242, lon: 33.2037, region: "Сумська обл." },
  { name: "Старокостянтинів", lat: 49.7562, lon: 27.2212, region: "Хмельницька обл." },
  { name: "Яворів", lat: 49.937, lon: 23.394, region: "Львівська обл." },

  // Border & Maritime References
  { name: "Жешув / Пшемисль", lat: 50.041, lon: 22.003, region: "Польща (прикордоння)" },
  { name: "Люблін", lat: 51.246, lon: 22.568, region: "Польща" },
  { name: "Сучава", lat: 47.651, lon: 26.255, region: "Румунія (прикордоння)" },
  { name: "Кишинів", lat: 47.0105, lon: 28.8638, region: "Молдова" },
  { name: "Констанца", lat: 44.1807, lon: 28.6343, region: "Чорне море / Румунія" },
  { name: "Варна", lat: 43.2141, lon: 27.9147, region: "Чорне море / Болгарія" },
  { name: "Брест", lat: 52.0976, lon: 23.7341, region: "Північне прикордоння" }
];

const getCompassDirectionUk = (bearing: number): string => {
  const normalized = ((bearing % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return "північ";
  if (normalized >= 22.5 && normalized < 67.5) return "північний схід";
  if (normalized >= 67.5 && normalized < 112.5) return "схід";
  if (normalized >= 112.5 && normalized < 157.5) return "південний схід";
  if (normalized >= 157.5 && normalized < 202.5) return "південь";
  if (normalized >= 202.5 && normalized < 247.5) return "південний захід";
  if (normalized >= 247.5 && normalized < 292.5) return "захід";
  return "північний захід";
};

export const findNearestLandmark = (lat: number, lon: number): string => {
  let closest: Landmark | null = null;
  let minDistanceM = Infinity;

  for (const lm of LANDMARKS) {
    const dist = haversineMeters({ lat, lon }, { lat: lm.lat, lon: lm.lon });
    if (dist < minDistanceM) {
      minDistanceM = dist;
      closest = lm;
    }
  }

  if (!closest) {
    return `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`;
  }

  const distKm = Math.round(minDistanceM / 1000);
  if (distKm <= 8) {
    return `${closest.name} (${closest.region ?? ""})`.trim();
  }

  const bearing = bearingDegrees({ lat: closest.lat, lon: closest.lon }, { lat, lon });
  const dir = getCompassDirectionUk(bearing);

  return `~${distKm} км на ${dir} від м. ${closest.name} (${closest.region ?? ""})`.trim();
};
