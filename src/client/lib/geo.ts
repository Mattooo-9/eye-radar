export interface GeoPoint {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

export const haversineMeters = (a: GeoPoint, b: GeoPoint): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(value));
};

export const bearingDegrees = (a: GeoPoint, b: GeoPoint): number => {
  const lat1Rad = toRadians(a.lat);
  const lat2Rad = toRadians(b.lat);
  const dLon = toRadians(b.lon - a.lon);

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  const deg = toDegrees(Math.atan2(y, x));
  return (deg + 360) % 360;
};

export function destinationPoint(
  point: GeoPoint,
  heading: number,
  distanceMeters: number
): GeoPoint;
export function destinationPoint(
  lat: number,
  lon: number,
  heading: number,
  distanceMeters: number
): GeoPoint;
export function destinationPoint(
  pointOrLat: GeoPoint | number,
  headingOrLon: number,
  distanceMetersOrHeading: number,
  maybeDistanceMeters?: number
): GeoPoint {
  let lat: number;
  let lon: number;
  let heading: number;
  let distanceMeters: number;

  if (typeof pointOrLat === "number") {
    lat = pointOrLat;
    lon = headingOrLon;
    heading = distanceMetersOrHeading;
    distanceMeters = maybeDistanceMeters ?? 0;
  } else {
    lat = pointOrLat.lat;
    lon = pointOrLat.lon;
    heading = headingOrLon;
    distanceMeters = distanceMetersOrHeading;
  }

  const angularDistance = distanceMeters / EARTH_RADIUS_M;
  const headingRad = toRadians(heading);
  const latRad = toRadians(lat);
  const lonRad = toRadians(lon);

  const nextLat = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(headingRad)
  );

  const nextLon =
    lonRad +
    Math.atan2(
      Math.sin(headingRad) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(nextLat)
    );

  return {
    lat: toDegrees(nextLat),
    lon: toDegrees(nextLon)
  };
}
