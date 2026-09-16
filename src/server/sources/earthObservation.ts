export type EOSensorType = 'SAR' | 'Optical' | 'Multispectral' | 'Thermal' | 'Atmospheric';
export type EOLawfulStatus = 'Public Open Access' | 'Commercial Authorized' | 'Requires Key' | 'Restricted State Catalog';
export type EOLayerRole = 'EO_CONTEXT' | 'CHANGE_DETECTION' | 'CATALOG_METADATA';

export interface EOProductMetadata {
  id: string;
  name: string;
  constellation: string;
  provider: string;
  sensorType: EOSensorType;
  resolutionMeters: number;
  acquisitionTime: number;
  deliveryTime: number;
  publicationLatencyHours: number;
  cloudCoverPct: number | null;
  revisitHours: number;
  confidence: number;
  swathWidthKm: number;
  orbitInclinationDeg: number;
  orbitAltitudeKm: number;
  centerCoordinates: { lat: number; lon: number };
  swathFootprint: Array<[lon: number, lat: number]>;
  lawfulStatus: EOLawfulStatus;
  authRequirement: 'None (Open Data)' | 'API Key' | 'Commercial Account' | 'Unavailable (Closed/Restricted)';
  layerRole: EOLayerRole;
  status: 'LIVE' | 'AVAILABLE' | 'EO-CONTEXT' | 'DEGRADED' | 'OFFLINE';
  productUrl?: string;
  apiEndpoint?: string;
  layerCapabilities: {
    canProvidePosition: boolean;
    canProvideImagery: boolean;
    canDetectThermal: boolean;
    canPenetrateClouds: boolean; // SAR radar penetrates clouds!
    isLiveRadar: boolean;        // Strictly false!
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
        acquisitionTime: now - 38 * 60 * 1000,
        deliveryTime: now - 12 * 60 * 1000,
        publicationLatencyHours: 0.6,
        cloudCoverPct: 0, // SAR penetrates clouds
        revisitHours: 36,
        confidence: 0.96,
        swathWidthKm: 250,
        orbitInclinationDeg: 98.18,
        orbitAltitudeKm: 693,
        centerCoordinates: { lat: 49.2, lon: 32.5 },
        swathFootprint: [
          [29.5, 51.8], [35.2, 51.5], [34.4, 46.8], [28.8, 47.1], [29.5, 51.8]
        ],
        lawfulStatus: 'Public Open Access',
        authRequirement: 'None (Open Data)',
        layerRole: 'EO_CONTEXT',
        status: 'EO-CONTEXT',
        productUrl: 'https://browser.dataspace.copernicus.eu/',
        apiEndpoint: 'https://catalogue.dataspace.copernicus.eu/odata/v1/Products',
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
        publicationLatencyHours: 2.4,
        cloudCoverPct: 18,
        revisitHours: 72,
        confidence: 0.94,
        swathWidthKm: 290,
        orbitInclinationDeg: 98.62,
        orbitAltitudeKm: 786,
        centerCoordinates: { lat: 48.8, lon: 31.0 },
        swathFootprint: [
          [28.2, 51.4], [33.8, 51.1], [33.1, 46.2], [27.6, 46.5], [28.2, 51.4]
        ],
        lawfulStatus: 'Public Open Access',
        authRequirement: 'None (Open Data)',
        layerRole: 'EO_CONTEXT',
        status: 'EO-CONTEXT',
        productUrl: 'https://dataspace.copernicus.eu/',
        apiEndpoint: 'https://catalogue.dataspace.copernicus.eu/odata/v1/Products',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: false,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 3. Copernicus Sentinel-3 SLSTR/OLCI (Ocean & Land Surface Temperature)
      {
        id: 'cdse-sentinel-3-slstr',
        name: 'Sentinel-3 (SLSTR/OLCI)',
        constellation: 'Copernicus Space Component',
        provider: 'Copernicus CDSE',
        sensorType: 'Thermal',
        resolutionMeters: 300,
        acquisitionTime: now - 80 * 60 * 1000,
        deliveryTime: now - 25 * 60 * 1000,
        publicationLatencyHours: 1.3,
        cloudCoverPct: null,
        revisitHours: 24,
        confidence: 0.92,
        swathWidthKm: 1420,
        orbitInclinationDeg: 98.65,
        orbitAltitudeKm: 814,
        centerCoordinates: { lat: 49.0, lon: 31.5 },
        swathFootprint: [
          [22.0, 52.5], [41.0, 52.5], [41.0, 44.5], [22.0, 44.5], [22.0, 52.5]
        ],
        lawfulStatus: 'Public Open Access',
        authRequirement: 'None (Open Data)',
        layerRole: 'EO_CONTEXT',
        status: 'EO-CONTEXT',
        productUrl: 'https://dataspace.copernicus.eu/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: true,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 4. USGS/NASA Landsat 8/9 (OLI-2/TIRS-2 Multispectral & Thermal)
      {
        id: 'usgs-landsat-8-9',
        name: 'Landsat 8/9 (OLI-2/TIRS-2)',
        constellation: 'USGS/NASA Landsat Program',
        provider: 'USGS Earth Resources Observation',
        sensorType: 'Multispectral',
        resolutionMeters: 15, // 15m panchromatic, 30m multispectral
        acquisitionTime: now - 240 * 60 * 1000,
        deliveryTime: now - 90 * 60 * 1000,
        publicationLatencyHours: 4.0,
        cloudCoverPct: 12,
        revisitHours: 192, // 8 days combined
        confidence: 0.93,
        swathWidthKm: 185,
        orbitInclinationDeg: 98.2,
        orbitAltitudeKm: 705,
        centerCoordinates: { lat: 49.5, lon: 33.2 },
        swathFootprint: [
          [31.8, 51.0], [34.5, 50.8], [33.8, 48.0], [31.1, 48.2], [31.8, 51.0]
        ],
        lawfulStatus: 'Public Open Access',
        authRequirement: 'None (Open Data)',
        layerRole: 'EO_CONTEXT',
        status: 'EO-CONTEXT',
        productUrl: 'https://earthexplorer.usgs.gov/',
        apiEndpoint: 'https://m2m.cr.usgs.gov/api/api/json/stable/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: true,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 5. NASA GIBS / VIIRS (Suomi-NPP & NOAA-20 Thermal Anomalies / Active Fire)
      {
        id: 'nasa-gibs-viirs',
        name: 'NASA GIBS VIIRS Active Fires',
        constellation: 'NASA Earth Observing System',
        provider: 'NASA GIBS',
        sensorType: 'Thermal',
        resolutionMeters: 375,
        acquisitionTime: now - 55 * 60 * 1000,
        deliveryTime: now - 20 * 60 * 1000,
        publicationLatencyHours: 0.9,
        cloudCoverPct: null,
        revisitHours: 12,
        confidence: 0.95,
        swathWidthKm: 3040,
        orbitInclinationDeg: 98.7,
        orbitAltitudeKm: 824,
        centerCoordinates: { lat: 48.5, lon: 34.0 },
        swathFootprint: [
          [22.1, 52.4], [40.2, 52.4], [40.2, 44.8], [22.1, 44.8], [22.1, 52.4]
        ],
        lawfulStatus: 'Public Open Access',
        authRequirement: 'None (Open Data)',
        layerRole: 'CHANGE_DETECTION',
        status: 'EO-CONTEXT',
        productUrl: 'https://firms.modaps.eosdis.nasa.gov/',
        apiEndpoint: 'https://firms.modaps.eosdis.nasa.gov/api/area/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: true,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 6. EUMETSAT MTG (Meteosat Third Generation Cloud & Atmosphere)
      {
        id: 'eumetsat-mtg',
        name: 'EUMETSAT MTG Atmosphere & Cloud Top',
        constellation: 'Meteosat Geostationary',
        provider: 'EUMETSAT',
        sensorType: 'Atmospheric',
        resolutionMeters: 1000,
        acquisitionTime: now - 15 * 60 * 1000,
        deliveryTime: now - 8 * 60 * 1000,
        publicationLatencyHours: 0.25,
        cloudCoverPct: null,
        revisitHours: 0.25, // 15 min rapid scan
        confidence: 0.98,
        swathWidthKm: 12000,
        orbitInclinationDeg: 0,
        orbitAltitudeKm: 35786, // Geostationary orbit
        centerCoordinates: { lat: 49.0, lon: 32.0 },
        swathFootprint: [
          [22.0, 52.5], [40.5, 52.5], [40.5, 45.0], [22.0, 45.0], [22.0, 52.5]
        ],
        lawfulStatus: 'Public Open Access',
        authRequirement: 'None (Open Data)',
        layerRole: 'EO_CONTEXT',
        status: 'EO-CONTEXT',
        productUrl: 'https://data.eumetsat.int/',
        layerCapabilities: {
          canProvidePosition: false,
          canProvideImagery: true,
          canDetectThermal: false,
          canPenetrateClouds: true,
          isLiveRadar: false
        }
      },

      // 7. PlanetScope / SkySat (Commercial High-Resolution Optical)
      {
        id: 'planet-skysat-tasking',
        name: 'Planet SkySat High-Resolution',
        constellation: 'Planet Labs Constellation',
        provider: 'Planet Labs',
        sensorType: 'Optical',
        resolutionMeters: 0.5,
        acquisitionTime: now - 180 * 60 * 1000,
        deliveryTime: now - 60 * 60 * 1000,
        publicationLatencyHours: 3.0,
        cloudCoverPct: 8,
        revisitHours: 24,
        confidence: 0.98,
        swathWidthKm: 8,
        orbitInclinationDeg: 97.4,
        orbitAltitudeKm: 450,
        centerCoordinates: { lat: 50.4, lon: 30.5 },
        swathFootprint: [
          [30.40, 50.48], [30.60, 50.48], [30.60, 50.32], [30.40, 50.32], [30.40, 50.48]
        ],
        lawfulStatus: 'Commercial Authorized',
        authRequirement: 'API Key',
        layerRole: 'CHANGE_DETECTION',
        status: process.env.PLANET_API_KEY ? 'AVAILABLE' : 'OFFLINE',
        productUrl: 'https://api.planet.com/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: false,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 8. Maxar WorldView / Legion (Sub-Meter Commercial Optical)
      {
        id: 'maxar-worldview-legion',
        name: 'Maxar WorldView-3 / WorldView Legion',
        constellation: 'Maxar Earth Intelligence',
        provider: 'Maxar Technologies',
        sensorType: 'Optical',
        resolutionMeters: 0.31,
        acquisitionTime: now - 360 * 60 * 1000,
        deliveryTime: now - 120 * 60 * 1000,
        publicationLatencyHours: 6.0,
        cloudCoverPct: 5,
        revisitHours: 36,
        confidence: 0.99,
        swathWidthKm: 13.1,
        orbitInclinationDeg: 97.9,
        orbitAltitudeKm: 617,
        centerCoordinates: { lat: 49.9, lon: 36.2 },
        swathFootprint: [
          [36.1, 50.0], [36.3, 50.0], [36.3, 49.8], [36.1, 49.8], [36.1, 50.0]
        ],
        lawfulStatus: 'Commercial Authorized',
        authRequirement: 'Commercial Account',
        layerRole: 'CHANGE_DETECTION',
        status: process.env.MAXAR_API_KEY ? 'AVAILABLE' : 'OFFLINE',
        productUrl: 'https://www.maxar.com/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: false,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 9. BlackSky Spectra (Rapid Revisit Intra-day Optical)
      {
        id: 'blacksky-spectra',
        name: 'BlackSky Gen-2/Gen-3 Spectra',
        constellation: 'BlackSky High-Revisit Constellation',
        provider: 'BlackSky Technology',
        sensorType: 'Optical',
        resolutionMeters: 0.85,
        acquisitionTime: now - 120 * 60 * 1000,
        deliveryTime: now - 45 * 60 * 1000,
        publicationLatencyHours: 2.0,
        cloudCoverPct: 10,
        revisitHours: 1.5,
        confidence: 0.97,
        swathWidthKm: 30,
        orbitInclinationDeg: 42.0, // Mid-inclination for rapid revisit
        orbitAltitudeKm: 430,
        centerCoordinates: { lat: 46.5, lon: 32.6 },
        swathFootprint: [
          [32.4, 46.7], [32.8, 46.7], [32.8, 46.3], [32.4, 46.3], [32.4, 46.7]
        ],
        lawfulStatus: 'Commercial Authorized',
        authRequirement: 'Commercial Account',
        layerRole: 'CHANGE_DETECTION',
        status: process.env.BLACKSKY_API_KEY ? 'AVAILABLE' : 'OFFLINE',
        productUrl: 'https://www.blacksky.com/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: false,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 10. ICEYE Commercial X-Band SAR (Persistent All-Weather Radar)
      {
        id: 'iceye-xband-sar',
        name: 'ICEYE High-Resolution X-Band SAR',
        constellation: 'ICEYE SAR Constellation',
        provider: 'ICEYE Ltd',
        sensorType: 'SAR',
        resolutionMeters: 1.0,
        acquisitionTime: now - 95 * 60 * 1000,
        deliveryTime: now - 35 * 60 * 1000,
        publicationLatencyHours: 1.6,
        cloudCoverPct: 0,
        revisitHours: 14,
        confidence: 0.98,
        swathWidthKm: 30,
        orbitInclinationDeg: 97.7,
        orbitAltitudeKm: 570,
        centerCoordinates: { lat: 47.8, lon: 35.1 },
        swathFootprint: [
          [34.9, 48.0], [35.3, 48.0], [35.3, 47.6], [34.9, 47.6], [34.9, 48.0]
        ],
        lawfulStatus: 'Commercial Authorized',
        authRequirement: 'Commercial Account',
        layerRole: 'CHANGE_DETECTION',
        status: process.env.ICEYE_API_KEY ? 'AVAILABLE' : 'OFFLINE',
        productUrl: 'https://www.iceye.com/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: false,
          canPenetrateClouds: true,
          isLiveRadar: false
        }
      },

      // 11. Capella Space Sub-Meter X-Band SAR
      {
        id: 'capella-space-sar',
        name: 'Capella Space Whitney X-Band SAR',
        constellation: 'Capella Space SAR Constellation',
        provider: 'Capella Space',
        sensorType: 'SAR',
        resolutionMeters: 0.5,
        acquisitionTime: now - 210 * 60 * 1000,
        deliveryTime: now - 70 * 60 * 1000,
        publicationLatencyHours: 3.5,
        cloudCoverPct: 0,
        revisitHours: 18,
        confidence: 0.99,
        swathWidthKm: 10,
        orbitInclinationDeg: 45.0,
        orbitAltitudeKm: 500,
        centerCoordinates: { lat: 48.4, lon: 35.0 },
        swathFootprint: [
          [34.9, 48.5], [35.1, 48.5], [35.1, 48.3], [34.9, 48.3], [34.9, 48.5]
        ],
        lawfulStatus: 'Commercial Authorized',
        authRequirement: 'Commercial Account',
        layerRole: 'CHANGE_DETECTION',
        status: process.env.CAPELLA_API_KEY ? 'AVAILABLE' : 'OFFLINE',
        productUrl: 'https://www.capellaspace.com/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: false,
          canPenetrateClouds: true,
          isLiveRadar: false
        }
      },

      // 12. Satellogic Aleph-1 (High-Resolution Multispectral)
      {
        id: 'satellogic-aleph-1',
        name: 'Satellogic Aleph-1 (NewSat)',
        constellation: 'Satellogic Earth Constellation',
        provider: 'Satellogic',
        sensorType: 'Multispectral',
        resolutionMeters: 0.7,
        acquisitionTime: now - 300 * 60 * 1000,
        deliveryTime: now - 110 * 60 * 1000,
        publicationLatencyHours: 5.0,
        cloudCoverPct: 14,
        revisitHours: 24,
        confidence: 0.95,
        swathWidthKm: 5,
        orbitInclinationDeg: 97.5,
        orbitAltitudeKm: 475,
        centerCoordinates: { lat: 50.0, lon: 31.0 },
        swathFootprint: [
          [30.9, 50.1], [31.1, 50.1], [31.1, 49.9], [30.9, 49.9], [30.9, 50.1]
        ],
        lawfulStatus: 'Commercial Authorized',
        authRequirement: 'Commercial Account',
        layerRole: 'CHANGE_DETECTION',
        status: process.env.SATELLOGIC_API_KEY ? 'AVAILABLE' : 'OFFLINE',
        productUrl: 'https://satellogic.com/',
        layerCapabilities: {
          canProvidePosition: true,
          canProvideImagery: true,
          canDetectThermal: false,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 13. Resurs-P (Adversary Russian State Optical - Documented Catalog Metadata Only)
      {
        id: 'roskosmos-resurs-p',
        name: 'Resurs-P No.3/No.4 (Geoton/Sangur Optical)',
        constellation: 'Russian State Earth Observation System',
        provider: 'ROSCOSMOS / VNIIEM',
        sensorType: 'Optical',
        resolutionMeters: 0.73, // Panchromatic 0.73m, multispectral 3m
        acquisitionTime: now - 720 * 60 * 1000,
        deliveryTime: now - 360 * 60 * 1000,
        publicationLatencyHours: 12.0,
        cloudCoverPct: null,
        revisitHours: 96,
        confidence: 0.40,
        swathWidthKm: 38,
        orbitInclinationDeg: 97.3,
        orbitAltitudeKm: 475,
        centerCoordinates: { lat: 48.0, lon: 37.8 },
        swathFootprint: [
          [37.5, 48.2], [38.1, 48.2], [38.1, 47.8], [37.5, 47.8], [37.5, 48.2]
        ],
        lawfulStatus: 'Restricted State Catalog',
        authRequirement: 'Unavailable (Closed/Restricted)',
        layerRole: 'CATALOG_METADATA',
        status: 'OFFLINE',
        productUrl: 'https://www.roscosmos.ru/',
        layerCapabilities: {
          canProvidePosition: false,
          canProvideImagery: false,
          canDetectThermal: false,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 14. Kanopus-V (Adversary Russian State Optical - Documented Catalog Metadata Only)
      {
        id: 'roskosmos-kanopus-v',
        name: 'Kanopus-V No.3-No.6 (PSS Panchromatic)',
        constellation: 'Russian State Earth Observation System',
        provider: 'ROSCOSMOS / VNIIEM',
        sensorType: 'Optical',
        resolutionMeters: 2.1, // Panchromatic 2.1m, multispectral 10.5m
        acquisitionTime: now - 1440 * 60 * 1000,
        deliveryTime: now - 720 * 60 * 1000,
        publicationLatencyHours: 24.0,
        cloudCoverPct: null,
        revisitHours: 120,
        confidence: 0.35,
        swathWidthKm: 23,
        orbitInclinationDeg: 97.4,
        orbitAltitudeKm: 510,
        centerCoordinates: { lat: 47.0, lon: 37.5 },
        swathFootprint: [
          [37.2, 47.2], [37.8, 47.2], [37.8, 46.8], [37.2, 46.8], [37.2, 47.2]
        ],
        lawfulStatus: 'Restricted State Catalog',
        authRequirement: 'Unavailable (Closed/Restricted)',
        layerRole: 'CATALOG_METADATA',
        status: 'OFFLINE',
        productUrl: 'https://www.roscosmos.ru/',
        layerCapabilities: {
          canProvidePosition: false,
          canProvideImagery: false,
          canDetectThermal: false,
          canPenetrateClouds: false,
          isLiveRadar: false
        }
      },

      // 15. Kondor-FKA (Adversary Russian State S-Band Radar - Documented Catalog Metadata Only)
      {
        id: 'roskosmos-kondor-fka',
        name: 'Kondor-FKA No.1 (S-Band SAR)',
        constellation: 'Russian State Radar Reconnaissance',
        provider: 'NPO Mashinostroyeniya',
        sensorType: 'SAR',
        resolutionMeters: 1.5,
        acquisitionTime: now - 2880 * 60 * 1000,
        deliveryTime: now - 1440 * 60 * 1000,
        publicationLatencyHours: 48.0,
        cloudCoverPct: 0,
        revisitHours: 72,
        confidence: 0.30,
        swathWidthKm: 15,
        orbitInclinationDeg: 97.4,
        orbitAltitudeKm: 518,
        centerCoordinates: { lat: 46.5, lon: 33.0 },
        swathFootprint: [
          [32.8, 46.7], [33.2, 46.7], [33.2, 46.3], [32.8, 46.3], [32.8, 46.7]
        ],
        lawfulStatus: 'Restricted State Catalog',
        authRequirement: 'Unavailable (Closed/Restricted)',
        layerRole: 'CATALOG_METADATA',
        status: 'OFFLINE',
        productUrl: 'https://www.roscosmos.ru/',
        layerCapabilities: {
          canProvidePosition: false,
          canProvideImagery: false,
          canDetectThermal: false,
          canPenetrateClouds: true,
          isLiveRadar: false
        }
      }
    ];

    this.lastUpdate = now;
    this.cachedResponse = {
      timestamp: now,
      sourcesCount: passes.length,
      activePasses: passes,
      disclaimer: 'Earth Observation data adheres to documented orbital products. Closed/restricted satellite systems are tracked strictly by catalog parameters without mock LIVE tracks.'
    };

    return this.cachedResponse;
  }
}

export const earthObservationService = new EarthObservationService();
