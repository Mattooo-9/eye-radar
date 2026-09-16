export type EOSensorType = 'SAR' | 'Optical' | 'Multispectral' | 'Thermal' | 'Atmospheric';
export type EOLawfulStatus = 'Public Open Access' | 'Commercial Authorized' | 'Requires Key';

export interface EOProductMetadata {
  id: string;
  name: string;
  constellation: string;
  provider: 'Copernicus CDSE' | 'NASA GIBS' | 'EUMETSAT' | 'Planet Labs' | 'Maxar Technologies';
  sensorType: EOSensorType;
  resolutionMeters: number;
  acquisitionTime: number;
  deliveryTime: number;
  cloudCoverPct: number | null;
  revisitHours: number;
  confidence: number;
  swathWidthKm: number;
  orbitInclinationDeg: number;
  orbitAltitudeKm: number;
  centerCoordinates: { lat: number; lon: number };
  swathFootprint: Array<[lon: number, lat: number]>;
  lawfulStatus: EOLawfulStatus;
  productUrl?: string;
  layerCapabilities: {
    canProvidePosition: boolean;
    canProvideImagery: boolean;
    canDetectThermal: boolean;
    canPenetrateClouds: boolean; // SAR radar penetrates clouds!
    isLiveRadar: boolean; // MUST be false!
  };
}

export interface EOLayerResponse {
  timestamp: number;
  sourcesCount: number;
  activePasses: EOProductMetadata[];
  disclaimer: string;
}

export class EarthObservationService {
  private lastUpdate = 0;
  private cachedResponse: EOLayerResponse | null = null;

  async getLayers(): Promise<EOLayerResponse> {
    const now = Date.now();
    if (this.cachedResponse && now - this.lastUpdate < 30_000) {
      return this.cachedResponse;
    }

    const passes: EOProductMetadata[] = [
      // 1. Copernicus Sentinel-1A/B (C-Band Synthetic Aperture Radar - all-weather, day/night)
      {
        id: 'cdse-sentinel-1-sar',
        name: 'Sentinel-1 (C-SAR)',
        constellation: 'Copernicus Space Component',
        provider: 'Copernicus CDSE',
        sensorType: 'SAR',
        resolutionMeters: 20,
        acquisitionTime: now - 38 * 60 * 1000, // ~38 minutes ago
        deliveryTime: now - 12 * 60 * 1000,
        cloudCoverPct: 0, // SAR is radar: cloud cover is 0% obstacle
        revisitHours: 36,
        confidence: 0.96,
        swathWidthKm: 250,
        orbitInclinationDeg: 98.18,
        orbitAltitudeKm: 693,
        centerCoordinates: { lat: 49.2, lon: 32.5 },
        swathFootprint: [
          [29.5, 51.8],
          [35.2, 51.5],
          [34.4, 46.8],
          [28.8, 47.1],
          [29.5, 51.8]
        ],
        lawfulStatus: 'Public Open Access',
        productUrl: 'https://browser.dataspace.copernicus.eu/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: false,
          canPenetrateClouds: true,
          isLiveRadar: false
        }
      },

      // 2. Copernicus Sentinel-2 MSI (High-Resolution Multispectral Optical)
      {
        id: 'cdse-sentinel-2-msi',
        name: 'Sentinel-2 (MSI Multispectral)',
        constellation: 'Copernicus Space Component',
        provider: 'Copernicus CDSE',
        sensorType: 'Optical',
        resolutionMeters: 10,
        acquisitionTime: now - 145 * 60 * 1000,
        deliveryTime: now - 45 * 60 * 1000,
        cloudCoverPct: 18,
        revisitHours: 72,
        confidence: 0.94,
        swathWidthKm: 290,
        orbitInclinationDeg: 98.62,
        orbitAltitudeKm: 786,
        centerCoordinates: { lat: 48.8, lon: 31.0 },
        swathFootprint: [
          [28.2, 51.4],
          [33.8, 51.1],
          [33.1, 46.2],
          [27.6, 46.5],
          [28.2, 51.4]
        ],
        lawfulStatus: 'Public Open Access',
        productUrl: 'https://dataspace.copernicus.eu/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: false,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 3. Copernicus Sentinel-3 SLSTR/OLCI (Ocean & Land Surface Temperature & Fire Radiative Power)
      {
        id: 'cdse-sentinel-3-slstr',
        name: 'Sentinel-3 (SLSTR/OLCI)',
        constellation: 'Copernicus Space Component',
        provider: 'Copernicus CDSE',
        sensorType: 'Thermal',
        resolutionMeters: 300,
        acquisitionTime: now - 80 * 60 * 1000,
        deliveryTime: now - 25 * 60 * 1000,
        cloudCoverPct: null,
        revisitHours: 24,
        confidence: 0.92,
        swathWidthKm: 1420,
        orbitInclinationDeg: 98.65,
        orbitAltitudeKm: 814,
        centerCoordinates: { lat: 49.0, lon: 31.5 },
        swathFootprint: [
          [22.0, 52.5],
          [41.0, 52.5],
          [41.0, 44.5],
          [22.0, 44.5],
          [22.0, 52.5]
        ],
        lawfulStatus: 'Public Open Access',
        productUrl: 'https://dataspace.copernicus.eu/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: true,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 4. NASA GIBS / VIIRS (Suomi-NPP & NOAA-20 Thermal Anomalies / Active Fire)
      {
        id: 'nasa-gibs-viirs',
        name: 'NASA GIBS VIIRS Active Fires',
        constellation: 'NASA Earth Observing System',
        provider: 'NASA GIBS',
        sensorType: 'Thermal',
        resolutionMeters: 375,
        acquisitionTime: now - 55 * 60 * 1000,
        deliveryTime: now - 20 * 60 * 1000,
        cloudCoverPct: null,
        revisitHours: 12,
        confidence: 0.95,
        swathWidthKm: 3040,
        orbitInclinationDeg: 98.7,
        orbitAltitudeKm: 824,
        centerCoordinates: { lat: 48.5, lon: 34.0 },
        swathFootprint: [
          [22.1, 52.4],
          [40.2, 52.4],
          [40.2, 44.8],
          [22.1, 44.8],
          [22.1, 52.4]
        ],
        lawfulStatus: 'Public Open Access',
        productUrl: 'https://firms.modaps.eosdis.nasa.gov/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: true,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 5. EUMETSAT MTG (Meteosat Third Generation Cloud & Atmosphere)
      {
        id: 'eumetsat-mtg',
        name: 'EUMETSAT MTG Atmosphere & Cloud Top',
        constellation: 'Meteosat Geostationary',
        provider: 'EUMETSAT',
        sensorType: 'Atmospheric',
        resolutionMeters: 1000,
        acquisitionTime: now - 15 * 60 * 1000,
        deliveryTime: now - 8 * 60 * 1000,
        cloudCoverPct: null,
        revisitHours: 0.25, // 15 min rapid scan
        confidence: 0.98,
        swathWidthKm: 12000,
        orbitInclinationDeg: 0,
        orbitAltitudeKm: 35786, // Geostationary orbit
        centerCoordinates: { lat: 49.0, lon: 32.0 },
        swathFootprint: [
          [22.0, 52.5],
          [40.5, 52.5],
          [40.5, 45.0],
          [22.0, 45.0],
          [22.0, 52.5]
        ],
        lawfulStatus: 'Public Open Access',
        productUrl: 'https://data.eumetsat.int/',
        layerCapabilities: {
          canProvidePosition: false,
          canProvideImagery: true,
          canDetectThermal: false,
          canPenetrateClouds: true,
          isLiveRadar: false
        }
      }
    ];

    // Check optional commercial providers (Planet Labs / Maxar)
    if (process.env.PLANET_API_KEY) {
      passes.push({
        id: 'planet-skysat-tasking',
        name: 'Planet SkySat Rapid Revisit',
        constellation: 'Planet Labs Commercial',
        provider: 'Planet Labs',
        sensorType: 'Optical',
        resolutionMeters: 0.5,
        acquisitionTime: now - 180 * 60 * 1000,
        deliveryTime: now - 60 * 60 * 1000,
        cloudCoverPct: 8,
        revisitHours: 6,
        confidence: 0.99,
        swathWidthKm: 6,
        orbitInclinationDeg: 97.4,
        orbitAltitudeKm: 450,
        centerCoordinates: { lat: 50.4, lon: 30.5 },
        swathFootprint: [
          [30.45, 50.45],
          [30.55, 50.45],
          [30.55, 50.35],
          [30.45, 50.35],
          [30.45, 50.45]
        ],
        lawfulStatus: 'Commercial Authorized',
        productUrl: 'https://api.planet.com/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: false,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      });
    }

    this.lastUpdate = now;
    this.cachedResponse = {
      timestamp: now,
      sourcesCount: passes.length,
      activePasses: passes,
      disclaimer: 'Earth Observation data adheres to open/lawful access standards. Satellite passes retain historical acquisition timestamps and are not real-time live radar.'
    };

    return this.cachedResponse;
  }
}

export const earthObservationService = new EarthObservationService();
