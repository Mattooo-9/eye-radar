export interface EarthObservationSatellite {
  id: string;
  name: string;
  type: "sar_radar" | "optical" | "thermal" | "atmospheric";
  provider: "Copernicus CDSE" | "NASA GIBS" | "EUMETSAT";
  altitudeKm: number;
  periodMin: number;
  inclinationDeg: number;
  swathWidthKm: number;
  resolutionMeters: number;
  revisitHours: number;
  description: string;
  lawfulStatus: "Public Open Access";
  // Ephemeris epoch parameters
  epochLon: number;
  epochLat: number;
  epochHeading: number;
  epochTime: number;
}

export interface SatelliteTrack {
  id: string;
  name: string;
  type: "sar_radar" | "optical" | "thermal" | "atmospheric";
  provider: "Copernicus CDSE" | "NASA GIBS" | "EUMETSAT";
  lat: number;
  lon: number;
  heading: number;
  altitudeKm: number;
  speedKmh: number;
  swathWidthKm: number;
  resolutionMeters: number;
  revisitHours: number;
  inRangeOfUkraine: boolean;
  description: string;
  isLiveRadar: false;
}

// Official Open-Access Earth Observation Satellites (Copernicus CDSE, NASA GIBS, EUMETSAT)
export const RECON_SATELLITES: EarthObservationSatellite[] = [
  {
    id: "sat-sentinel-1a",
    name: "Copernicus Sentinel-1A (C-SAR)",
    type: "sar_radar",
    provider: "Copernicus CDSE",
    altitudeKm: 693,
    periodMin: 98.6,
    inclinationDeg: 98.18,
    swathWidthKm: 250,
    resolutionMeters: 20,
    revisitHours: 36,
    description: "Радар синтезованої апертури SAR: всепогодний цілодобовий моніторинг рельєфу та інфраструктури крізь хмари",
    lawfulStatus: "Public Open Access",
    epochLon: 34.2,
    epochLat: 52.0,
    epochHeading: 192,
    epochTime: 1788984000000
  },
  {
    id: "sat-sentinel-2b",
    name: "Copernicus Sentinel-2B (MSI)",
    type: "optical",
    provider: "Copernicus CDSE",
    altitudeKm: 786,
    periodMin: 100.6,
    inclinationDeg: 98.62,
    swathWidthKm: 290,
    resolutionMeters: 10,
    revisitHours: 72,
    description: "Високороздільна мультиспектральна оптична зйомка високої чіткості (10м/пікс)",
    lawfulStatus: "Public Open Access",
    epochLon: 31.0,
    epochLat: 46.5,
    epochHeading: 194,
    epochTime: 1788984600000
  },
  {
    id: "sat-sentinel-3a",
    name: "Copernicus Sentinel-3A (SLSTR)",
    type: "thermal",
    provider: "Copernicus CDSE",
    altitudeKm: 814,
    periodMin: 101.0,
    inclinationDeg: 98.65,
    swathWidthKm: 1420,
    resolutionMeters: 300,
    revisitHours: 24,
    description: "Тепловий та поверхневий сенсор температури суші й радіаційної потужності пожеж",
    lawfulStatus: "Public Open Access",
    epochLon: 36.8,
    epochLat: 49.5,
    epochHeading: 135,
    epochTime: 1788983200000
  },
  {
    id: "sat-viirs-snpp",
    name: "NASA Suomi-NPP (VIIRS)",
    type: "thermal",
    provider: "NASA GIBS",
    altitudeKm: 824,
    periodMin: 101.5,
    inclinationDeg: 98.7,
    swathWidthKm: 3040,
    resolutionMeters: 375,
    revisitHours: 12,
    description: "Спектрорадіометр NASA GIBS/FIRMS: фіксація термоаномалій та детонацій високої інтенсивності",
    lawfulStatus: "Public Open Access",
    epochLon: 28.5,
    epochLat: 51.2,
    epochHeading: 142,
    epochTime: 1788985100000
  },
  {
    id: "sat-eumetsat-mtg",
    name: "EUMETSAT MTG-I1 (FCI)",
    type: "atmospheric",
    provider: "EUMETSAT",
    altitudeKm: 35786,
    periodMin: 1436.0,
    inclinationDeg: 0.1,
    swathWidthKm: 12000,
    resolutionMeters: 1000,
    revisitHours: 0.25,
    description: "Геостаціонарний метеорологічний моніторинг висоти хмарного покриву, опадів та атмосфери",
    lawfulStatus: "Public Open Access",
    epochLon: 33.5,
    epochLat: 48.0,
    epochHeading: 180,
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
      provider: sat.provider,
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
      heading: Math.round(heading),
      altitudeKm: sat.altitudeKm,
      speedKmh,
      swathWidthKm: sat.swathWidthKm,
      resolutionMeters: sat.resolutionMeters,
      revisitHours: sat.revisitHours,
      inRangeOfUkraine: inRange,
      description: sat.description,
      isLiveRadar: false
    };
  });
};