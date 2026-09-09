export interface ReconSatellite {
  id: string;
  name: string;
  type: "optical" | "sar_radar" | "elint";
  country: "RU";
  altitudeKm: number;
  periodMin: number;
  inclinationDeg: number;
  swathWidthKm: number;
  description: string;
  // Ephemeris epoch parameters
  epochLon: number;
  epochLat: number;
  epochHeading: number;
  epochTime: number;
}

export interface SatelliteTrack {
  id: string;
  name: string;
  type: "optical" | "sar_radar" | "elint";
  lat: number;
  lon: number;
  heading: number;
  altitudeKm: number;
  speedKmh: number;
  swathWidthKm: number;
  inRangeOfUkraine: boolean;
  description: string;
}

// Active Russian military reconnaissance satellites monitoring the Ukrainian theater
export const RECON_SATELLITES: ReconSatellite[] = [
  {
    id: "sat-persona-3",
    name: "Персона-3 (Космос-2506)",
    type: "optical",
    country: "RU",
    altitudeKm: 720,
    periodMin: 99.2,
    inclinationDeg: 98.2,
    swathWidthKm: 180,
    description: "Оптико-електронна розвідка високої роздільної здатності (0.3м)",
    epochLon: 34.2,
    epochLat: 52.0,
    epochHeading: 192,
    epochTime: 1788984000000
  },
  {
    id: "sat-kondor-fka",
    name: "Кондор-ФКА №1",
    type: "sar_radar",
    country: "RU",
    altitudeKm: 518,
    periodMin: 95.0,
    inclinationDeg: 97.4,
    swathWidthKm: 220,
    description: "Всепогодний радіолокаційний радар SAR з синтезованою апертурою",
    epochLon: 31.0,
    epochLat: 46.5,
    epochHeading: 194,
    epochTime: 1788984600000
  },
  {
    id: "sat-bars-m",
    name: "Барс-М №3 (Космос-2553)",
    type: "optical",
    country: "RU",
    altitudeKm: 525,
    periodMin: 95.2,
    inclinationDeg: 67.4,
    swathWidthKm: 160,
    description: "Стереоскопічна картографічна та тактична розвідка",
    epochLon: 36.8,
    epochLat: 49.5,
    epochHeading: 135,
    epochTime: 1788983200000
  },
  {
    id: "sat-lotos-s1",
    name: "Лотос-С1 №4 (Космос-2545)",
    type: "elint",
    country: "RU",
    altitudeKm: 900,
    periodMin: 103.0,
    inclinationDeg: 67.1,
    swathWidthKm: 450,
    description: "Радіотехнічна розвідка (РТР / ELINT, пеленгація РЛС та зв'язку)",
    epochLon: 28.5,
    epochLat: 51.2,
    epochHeading: 142,
    epochTime: 1788985100000
  },
  {
    id: "sat-resurs-p4",
    name: "Ресурс-П №4",
    type: "optical",
    country: "RU",
    altitudeKm: 475,
    periodMin: 94.1,
    inclinationDeg: 97.3,
    swathWidthKm: 140,
    description: "Детальна багатоспектральна зйомка об'єктів інфраструктури",
    epochLon: 33.5,
    epochLat: 48.0,
    epochHeading: 196,
    epochTime: 1788982500000
  }
];

export const calculateSatellitePositions = (timeMs = Date.now()): SatelliteTrack[] => {
  return RECON_SATELLITES.map((sat) => {
    const elapsedSec = (timeMs - sat.epochTime) / 1000;
    const periodSec = sat.periodMin * 60;
    const phase = (elapsedSec % periodSec) / periodSec; // 0..1
    const angleRad = phase * Math.PI * 2;

    // Orbital latitude oscillation bounded by inclination
    const maxLat = Math.min(82, sat.inclinationDeg > 90 ? 180 - sat.inclinationDeg : sat.inclinationDeg);
    const lat = Math.sin(angleRad) * maxLat;

    // Earth rotation under satellite orbit (360 deg per 86164 sec sidereal day)
    const earthRotDeg = (elapsedSec / 86164) * 360;
    // Orbital longitude progression
    const orbitLonProgression = phase * 360;
    let lon = (sat.epochLon - earthRotDeg + (sat.inclinationDeg > 90 ? -orbitLonProgression : orbitLonProgression)) % 360;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;

    // Heading calculation
    const dLat = Math.cos(angleRad) * maxLat;
    const dLon = sat.inclinationDeg > 90 ? -1 : 1;
    const headingRad = Math.atan2(dLon, dLat);
    let heading = (headingRad * 180) / Math.PI;
    if (heading < 0) heading += 360;

    // Orbital speed (v = sqrt(G*M / r)) ~ 27,000 km/h
    const speedKmh = 27400;

    // Check if swath touches Ukrainian airspace (lat 44..53, lon 22..41)
    const inRange = lat >= 41 && lat <= 56 && lon >= 18 && lon <= 45;

    return {
      id: sat.id,
      name: sat.name,
      type: sat.type,
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
      heading: Math.round(heading),
      altitudeKm: sat.altitudeKm,
      speedKmh,
      swathWidthKm: sat.swathWidthKm,
      inRangeOfUkraine: inRange,
      description: sat.description
    };
  });
};