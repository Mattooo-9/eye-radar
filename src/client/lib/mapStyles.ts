import { Protocol } from "pmtiles";
import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";

export const OPENFREEMAP_DARK_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
export const PROTOMAPS_GLYPHS_URL =
  "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
export const PROTOMAPS_SPRITE_DARK_URL =
  "https://protomaps.github.io/basemaps-assets/sprites/v4/dark";
export const LOCAL_PMTILES_PATH = "/tiles/ukraine-overview.pmtiles";

const ESRI_WORLD_IMAGERY_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
];
const ESRI_REFERENCE_LABELS_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
];

let protocolRegistered = false;
let sharedProtocol: Protocol | null = null;

/**
 * Idempotently registers the official PMTiles v3 protocol with MapLibre GL.
 */
export function ensurePmtilesProtocol(maplibre: {
  addProtocol: (customProtocol: string, loadFn: any) => void;
}): Protocol {
  if (!sharedProtocol) {
    sharedProtocol = new Protocol();
  }
  if (!protocolRegistered) {
    maplibre.addProtocol("pmtiles", sharedProtocol.tile);
    protocolRegistered = true;
  }
  return sharedProtocol;
}

export function resolveAbsolutePmtilesUrl(pathOrUrl?: string): string {
  const candidate = (pathOrUrl || LOCAL_PMTILES_PATH).trim();
  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${candidate.startsWith("/") ? candidate : `/${candidate}`}`;
  }
  return `https://eye-radar.vercel.app${candidate.startsWith("/") ? candidate : `/${candidate}`}`;
}

/**
 * Full dark vector basemap powered by Protomaps PMTiles v3 + @protomaps/basemaps
 * with Ukrainian (uk) label localization.
 */
export function buildProtomapsDarkStyle(pmtilesUrl?: string): StyleSpecification {
  const absoluteUrl = resolveAbsolutePmtilesUrl(pmtilesUrl);
  const darkLayers = protomapsLayers("protomaps", namedFlavor("dark"), {
    lang: "uk"
  }) as StyleSpecification["layers"];

  return {
    version: 8,
    glyphs: PROTOMAPS_GLYPHS_URL,
    sprite: PROTOMAPS_SPRITE_DARK_URL,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${absoluteUrl}`,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'
      }
    },
    layers: darkLayers
  };
}

/**
 * Realistic satellite imagery basemap (Esri World Imagery) paired with crisp GPU-rendered
 * Protomaps PMTiles Ukrainian vector boundaries & labels at overview zooms (z0-z6)
 * and Esri Reference labels at city/road zoom (z6+).
 * Eliminates unofficial rate-limited Google dual-raster streams and saves mobile bandwidth.
 */
export function buildRealisticSatelliteStyle(options: {
  performanceTier?: "LOW" | "NORMAL" | "HIGH";
  pmtilesUrl?: string;
} = {}): StyleSpecification {
  const isLow = options.performanceTier === "LOW";
  const absolutePmtilesUrl = resolveAbsolutePmtilesUrl(options.pmtilesUrl);

  const allDarkLayers = protomapsLayers("protomaps", namedFlavor("dark"), {
    lang: "uk"
  }) as Array<Record<string, any>>;

  // Keep only crisp Ukrainian boundaries & place labels from Protomaps for overview zooms
  const overlayLayers = allDarkLayers
    .filter((layer) => {
      const id = String(layer.id || "");
      return id.startsWith("boundaries") || id.startsWith("places_");
    })
    .map((layer) => ({
      ...layer,
      maxzoom: Math.min(typeof layer.maxzoom === "number" ? layer.maxzoom : 7, 7)
    })) as StyleSpecification["layers"];

  return {
    version: 8,
    glyphs: PROTOMAPS_GLYPHS_URL,
    sprite: PROTOMAPS_SPRITE_DARK_URL,
    sources: {
      "satellite-tiles": {
        type: "raster",
        tiles: ESRI_WORLD_IMAGERY_TILES,
        tileSize: 256,
        maxzoom: isLow ? 12 : 17,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics"
      },
      "reference-labels": {
        type: "raster",
        tiles: ESRI_REFERENCE_LABELS_TILES,
        tileSize: 256,
        minzoom: 6,
        maxzoom: isLow ? 12 : 16
      },
      protomaps: {
        type: "vector",
        url: `pmtiles://${absolutePmtilesUrl}`,
        maxzoom: 5,
        attribution: "© OpenStreetMap · Protomaps"
      }
    },
    layers: [
      {
        id: "satellite-tiles-layer",
        type: "raster",
        source: "satellite-tiles",
        paint: {
          "raster-opacity": 1.0,
          "raster-fade-duration": 0,
          "raster-resampling": "linear",
          "raster-brightness-max": 0.95,
          "raster-saturation": -0.05,
          "raster-contrast": 0.12
        }
      },
      {
        id: "reference-labels-layer",
        type: "raster",
        source: "reference-labels",
        minzoom: 6,
        paint: {
          "raster-opacity": 0.62,
          "raster-fade-duration": 0,
          "raster-resampling": "linear"
        }
      },
      ...overlayLayers
    ]
  };
}

export function resolveMapStyle(params: {
  visionMode: "satellite" | "nvg" | "flir" | "tactical";
  performanceTier: "LOW" | "NORMAL" | "HIGH";
  mapStyleUrl?: string;
  pmtilesUrl?: string;
  preferLocalPmtiles?: boolean;
}): { styleKey: string; style: string | StyleSpecification } {
  const { visionMode, performanceTier, mapStyleUrl, pmtilesUrl, preferLocalPmtiles } = params;

  // Offline / degraded-CDN resilient fallback: always render self-hosted Protomaps PMTiles dark style
  if (preferLocalPmtiles) {
    return {
      styleKey: `pmtiles-local-${LOCAL_PMTILES_PATH}`,
      style: buildProtomapsDarkStyle(LOCAL_PMTILES_PATH)
    };
  }

  if (visionMode === "tactical") {
    if (pmtilesUrl && pmtilesUrl.trim().length > 0) {
      return {
        styleKey: `pmtiles-custom-${pmtilesUrl}`,
        style: buildProtomapsDarkStyle(pmtilesUrl)
      };
    }
    if (mapStyleUrl && /\.pmtiles(\?|$)/i.test(mapStyleUrl)) {
      return {
        styleKey: `pmtiles-url-${mapStyleUrl}`,
        style: buildProtomapsDarkStyle(mapStyleUrl)
      };
    }
    const vectorUrl = mapStyleUrl || OPENFREEMAP_DARK_STYLE_URL;
    return {
      styleKey: `vector-${vectorUrl}`,
      style: vectorUrl
    };
  }

  // Realistic satellite / NVG / FLIR modes
  return {
    styleKey: `satellite-esri-pmtiles-${performanceTier}`,
    style: buildRealisticSatelliteStyle({
      performanceTier,
      pmtilesUrl: pmtilesUrl || LOCAL_PMTILES_PATH
    })
  };
}
