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
