export interface SubsolarPoint {
  lat: number;
  lon: number;
  declinationDeg: number;
}

export interface SolarStatus {
  elevationDeg: number;
  phase: "day" | "twilight" | "night";
  phaseTitle: string;
  phaseIcon: string;
}

/**
 * Calculates real astronomical subsolar point for the current UTC timestamp
 */
export const getSubsolarPoint = (date = new Date()): SubsolarPoint => {
  const now = date.getTime();
  // Julian Day
  const jd = now / 86400000 + 2440587.5;
  const d = jd - 2451545.0; // Days since J2000.0

  // Mean anomaly and longitude of the Sun
  const g = ((357.529 + 0.98560028 * d) % 360) * (Math.PI / 180);
  const q = ((280.459 + 0.98564736 * d) % 360) * (Math.PI / 180);
  const l =
    q + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);

  // Obliquity of the ecliptic
  const e = (23.439 - 0.00000036 * d) * (Math.PI / 180);

  // Sun declination and right ascension
  const sinDecl = Math.sin(e) * Math.sin(l);
  const declRad = Math.asin(sinDecl);
  const declDeg = (declRad * 180) / Math.PI;

  // Greenwich Hour Angle (subsolar longitude)
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3600000;

  // Approximate equation of time correction
  const eqTimeMin =
    4 * (l * (180 / Math.PI) - (Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) * (180 / Math.PI)));
  const subsolarLon = -((utcHours - 12) * 15 + eqTimeMin / 4);

  // Normalize lon to [-180, 180]
  const normLon = ((((subsolarLon + 180) % 360) + 360) % 360) - 180;

  return {
    lat: Math.max(-23.5, Math.min(23.5, declDeg)),
    lon: normLon,
    declinationDeg: declDeg
  };
};

/**
 * Calculates local sun elevation for specific coordinates
 */
export const getLocalSolarStatus = (
  lat: number,
  lon: number,
  date = new Date()
): SolarStatus => {
  const sub = getSubsolarPoint(date);
  const phi = (lat * Math.PI) / 180;
  const delta = (sub.lat * Math.PI) / 180;
  const lambdaDiff = ((lon - sub.lon) * Math.PI) / 180;

  const sinElev =
    Math.sin(phi) * Math.sin(delta) +
    Math.cos(phi) * Math.cos(delta) * Math.cos(lambdaDiff);
  const elevRad = Math.asin(Math.max(-1, Math.min(1, sinElev)));
  const elevDeg = (elevRad * 180) / Math.PI;

  if (elevDeg > 0) {
    return {
      elevationDeg: elevDeg,
      phase: "day",
      phaseTitle: "ДЕНЬ (СОНЦЕ)",
      phaseIcon: "☀️"
    };
  }
  if (elevDeg > -12) {
    return {
      elevationDeg: elevDeg,
      phase: "twilight",
      phaseTitle: "СУТІНКИ (ПЕРЕХІД)",
      phaseIcon: "🌅"
    };
  }
  return {
    elevationDeg: elevDeg,
    phase: "night",
    phaseTitle: "НІЧ (ТЕМРЯВА)",
    phaseIcon: "🌙"
  };
};

/**
 * Generates array of [lon, lat] points for the Day/Night terminator line across the globe
 */
export const getTerminatorCoordinates = (date = new Date()): Array<[number, number]> => {
  const sub = getSubsolarPoint(date);
  const tanDelta = Math.tan((sub.lat * Math.PI) / 180);
  const points: Array<[number, number]> = [];

  // If declination is tiny (equinox), terminator is roughly along meridians
  const safeTanDelta = Math.abs(tanDelta) < 0.0001 ? 0.0001 : tanDelta;

  for (let lon = -180; lon <= 180; lon += 3) {
    const dLon = ((lon - sub.lon) * Math.PI) / 180;
    const tanLat = -Math.cos(dLon) / safeTanDelta;
    const latRad = Math.atan(tanLat);
    const latDeg = (latRad * 180) / Math.PI;
    points.push([lon, latDeg]);
  }

  return points;
};
