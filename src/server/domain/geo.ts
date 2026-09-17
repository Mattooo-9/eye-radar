const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

export const normalizeHeading = (heading: number): number => {
  const normalized = heading % 360;
  return normalized >= 0 ? normalized : normalized + 360;
};

export const haversineMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
};

export const bearingDegrees = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);
  const dLon = toRadians(lon2 - lon1);

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  return normalizeHeading(toDegrees(Math.atan2(y, x)));
};

export const destinationPoint = (
  lat: number,
  lon: number,
  heading: number,
  distanceMeters: number
): { lat: number; lon: number } => {
  const angularDistance = distanceMeters / EARTH_RADIUS_M;
  const headingRad = toRadians(heading);
  const latRad = toRadians(lat);
  const lonRad = toRadians(lon);

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinDistance = Math.sin(angularDistance);
  const cosDistance = Math.cos(angularDistance);

  const nextLat = Math.asin(
    sinLat * cosDistance + cosLat * sinDistance * Math.cos(headingRad)
  );

  const nextLon =
    lonRad +
    Math.atan2(
      Math.sin(headingRad) * sinDistance * cosLat,
      cosDistance - sinLat * Math.sin(nextLat)
    );

  return {
    lat: toDegrees(nextLat),
    lon: toDegrees(nextLon)
  };
};

export const UKRAINE_BORDER_POLYGON: Array<[number, number]> = [
  // [lat, lon]
  [51.50, 23.60], // Volyn / Poland / Belarus tripoint
  [51.90, 25.50], // Belarus border
  [51.85, 28.00], // Zhytomyr / Belarus
  [51.50, 30.50], // Kyiv oblast north
  [52.10, 31.30], // Chernihiv / Belarus
  [52.38, 33.19], // Northernmost point (Hremyach / Novhorod-Siverskyi)
  [52.10, 34.20], // Sumy north
  [51.20, 34.50], // Sumy east
  [50.80, 35.30], // Sumy / Kharkiv
  [50.30, 36.00], // Kharkiv north
  [50.00, 38.20], // Kharkiv / Luhansk
  [49.26, 40.18], // Easternmost point (Rannytsia / Luhansk)
  [48.60, 40.00], // Luhansk east
  [48.00, 38.80], // Donetsk east
  [47.10, 38.20], // Novoazovsk / Azov Sea border
  [46.70, 36.80], // Berdyansk coast
  [45.40, 35.80], // Kerch Strait
  [44.39, 33.79], // Cape Sarich / Foros (Southernmost point of Crimea)
  [45.30, 32.50], // Cape Tarkhankut
  [46.30, 31.50], // Kinburn Spit / Dnipro estuary
  [45.35, 29.70], // Danube Delta (Vylkove / Black Sea)
  [45.30, 28.20], // Reni / Danube tripoint
  [45.80, 28.50], // Cahul / Moldova
  [46.40, 29.30], // Odesa / Moldova
  [47.50, 29.10], // Transnistria border
  [48.20, 27.50], // Mogilev-Podilskyi / Dnister
  [48.25, 26.60], // Chernivtsi / Moldova
  [47.90, 25.00], // Chernivtsi / Romania (Carpathians)
  [47.90, 24.20], // Solotvyno / Tisza / Romania
  [48.42, 22.14], // Chop (Westernmost point / Hungary / Slovakia)
  [49.00, 22.50], // Uzhok pass / Poland
  [49.80, 23.00], // Peremyshl / Mostyska (Lviv)
  [50.40, 24.10], // Sokal / Poland
  [50.80, 24.10], // Volodymyr / Poland
  [51.50, 23.60]  // Close polygon
];

export const isPointInPolygon = (lat: number, lon: number, polygon: Array<[number, number]>): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lonI] = polygon[i];
    const [latJ, lonJ] = polygon[j];
    const intersect =
      latI > lat !== latJ > lat &&
      lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI;
    if (intersect) inside = !inside;
  }
  return inside;
};

export const distanceToSegmentKm = (
  lat: number,
  lon: number,
  p1: [number, number],
  p2: [number, number]
): number => {
  const [lat1, lon1] = p1;
  const [lat2, lon2] = p2;
  const midLatRad = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const cosLat = Math.cos(midLatRad);

  const x = (lon - lon1) * 111.32 * cosLat;
  const y = (lat - lat1) * 111.32;
  const dx = (lon2 - lon1) * 111.32 * cosLat;
  const dy = (lat2 - lat1) * 111.32;

  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return haversineMeters(lat, lon, lat1, lon1) / 1000;
  }

  const t = Math.max(0, Math.min(1, (x * dx + y * dy) / lenSq));
  const projLon = lon1 + (lon2 - lon1) * t;
  const projLat = lat1 + (lat2 - lat1) * t;

  return haversineMeters(lat, lon, projLat, projLon) / 1000;
};

export const getDistanceToUkraineBorderKm = (lat: number, lon: number): number => {
  if (isPointInPolygon(lat, lon, UKRAINE_BORDER_POLYGON)) {
    return 0;
  }
  let minDist = Infinity;
  for (let i = 0, j = UKRAINE_BORDER_POLYGON.length - 1; i < UKRAINE_BORDER_POLYGON.length; j = i++) {
    const dist = distanceToSegmentKm(lat, lon, UKRAINE_BORDER_POLYGON[j], UKRAINE_BORDER_POLYGON[i]);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
};
