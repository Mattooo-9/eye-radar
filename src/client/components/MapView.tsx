import { useEffect, useRef } from "react";
import maplibregl, { type Map } from "maplibre-gl";
import type { ImpactEvent, TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { destinationPoint, haversineMeters } from "../lib/geo";
import { soundEngine } from "../lib/sound";
import { getSubsolarPoint, getTerminatorCoordinates, getLocalSolarStatus } from "../lib/solarTerminator";
import { findNearestLandmark } from "../lib/landmarks";
import { getLiveWeatherRadarTileUrl } from "../lib/weatherRadar";
import { calculateSatellitePositions, type SatelliteTrack } from "../lib/satelliteRecon";
import { getFrontlineGeoJSON } from "../lib/ukraineBorders";
import type { FilterState } from "./StatusPanel";
import { SpatialIndex } from "../lib/spatialIndex.js";
import { getTierConfig } from "../lib/hardwareBenchmark.js";
import { trackStore, isCivilAviation, type ClientUncertaintyEvent } from "../lib/trackStore.js";
import { renderTacticalGlyph } from "../lib/tacticalGlyphs.js";
import { LOCATIONS } from "./CitySelector";

export type VisionMode = "satellite" | "nvg" | "flir" | "tactical";

interface MapViewProps {
  packets: TrackPacket[];
  mapStyleUrl: string;
  location: TrustedLocation | null;
  confirmedLocation?: { lat: number; lon: number; name: string; region?: string } | null;
  filters?: FilterState;
  satelliteMode?: boolean;
  visionMode?: VisionMode;
  selectedTarget?: TrackPacket | null;
  isPickingLocation?: boolean;
  showDayNight?: boolean;
  showWeather?: boolean;
  showSatellites?: boolean;
  showFrontline?: boolean;
  showFirms?: boolean;
  showAviation?: boolean;
  showAlerts?: boolean;
  showUncertainty?: boolean;
  followingTargetId?: string | null;
  onStopFollow?: () => void;
  onMapReady?: (map: Map) => void;
  selectedLocation?: { lat: number; lon: number } | null;
  onSelectTarget?: (packet: TrackPacket) => void;
  onSelectLocation?: (lat: number, lon: number) => void;
  onPickLocation?: (lat: number, lon: number) => void;
  impacts?: ImpactEvent[];
  selectedImpact?: ImpactEvent | null;
  onSelectImpact?: (event: ImpactEvent) => void;
  timelineOffsetSec?: number;
  performanceTier?: "LOW" | "NORMAL" | "HIGH";
  activeAlerts?: string[];
}

const SATELLITE_STYLE = {
  version: 8 as const,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    "satellite-tiles": {
      type: "raster" as const,
      tiles: [
        "https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
        "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
        "https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
        "https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
      ],
      tileSize: 256,
      maxzoom: 18
    },
    "road-tiles": {
      type: "raster" as const,
      tiles: [
        "https://mt0.google.com/vt/lyrs=h&x={x}&y={y}&z={z}",
        "https://mt1.google.com/vt/lyrs=h&x={x}&y={y}&z={z}",
        "https://mt2.google.com/vt/lyrs=h&x={x}&y={y}&z={z}",
        "https://mt3.google.com/vt/lyrs=h&x={x}&y={y}&z={z}"
      ],
      tileSize: 256,
      maxzoom: 18
    }
  },
  layers: [
    {
      id: "satellite-tiles-layer",
      type: "raster" as const,
      source: "satellite-tiles",
      paint: {
        "raster-opacity": 1.0,
        "raster-fade-duration": 0,
        "raster-resampling": "linear" as const
      }
    },
    {
      id: "road-tiles-layer",
      type: "raster" as const,
      source: "road-tiles",
      paint: {
        "raster-opacity": 0.82,
        "raster-fade-duration": 0,
        "raster-resampling": "linear" as const
      }
    }
  ]
};

const SATELLITE_STYLE_LOW = {
  ...SATELLITE_STYLE,
  sources: {
    ...SATELLITE_STYLE.sources,
    "satellite-tiles": {
      ...SATELLITE_STYLE.sources["satellite-tiles"],
      maxzoom: 12
    },
    "road-tiles": {
      ...SATELLITE_STYLE.sources["road-tiles"],
      maxzoom: 12
    }
  }
};

const metersPerPixel = (latitude: number, zoom: number): number =>
  (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;

const drawTextWithOutline = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fillColor = "#f8fafc",
  strokeColor = "rgba(0, 0, 0, 0.9)",
  font = "bold 11px Inter, system-ui, sans-serif"
) => {
  ctx.save();
  ctx.font = font;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fillColor;
  ctx.fillText(text, x, y);
  ctx.restore();
};

const drawImpactEvent = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  event: ImpactEvent,
  now: number
) => {
  const isImpact = event.type === "impact";
  const elapsedMs = Math.max(0, now - event.timestamp);
  const maxTtlMs = isImpact ? 60 * 60 * 1000 : 10 * 60 * 1000; // Impacts 60m, Intercepts 10m

  // Drop events older than their respective TTL
  if (elapsedMs > maxTtlMs) return;

  const decayProgress = elapsedMs / maxTtlMs;
  const visualAlpha = Math.max(0.3, 1 - decayProgress * 0.7);

  ctx.save();
  ctx.globalAlpha = visualAlpha;

  // 2. Compact military tactical badge (clean, unbloated, high-contrast)
  const minAgo = Math.max(1, Math.round(elapsedMs / 60000));
  const timeText = elapsedMs < 60000 ? "< 1 хв тому" : minAgo < 60 ? `${minAgo} хв тому` : `${Math.floor(minAgo / 60)} год тому`;
  const label = isImpact ? `ПРИЛІТ (${timeText})` : `ЗБИТТЯ (${timeText})`;

  ctx.font = "bold 9px Inter, system-ui, -apple-system, sans-serif";
  const textWidth = ctx.measureText(label).width;
  const pillW = textWidth + 12;
  const pillH = 17;
  const pillX = x - pillW / 2;
  const pillY = y - pillH / 2;

  // Drop shadow
  ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;

  ctx.fillStyle = isImpact ? "rgba(127, 29, 29, 0.95)" : "rgba(14, 116, 144, 0.95)";
  ctx.strokeStyle = isImpact ? "#ef4444" : "#38bdf8";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, 4);
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(label, x, y + 0.5);

  ctx.restore();
};

const drawUavSilhouette = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number,
  color: string,
  timeMs: number,
  model?: string,
  speedKmh: number = 180
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);

  const isJet = Boolean(model?.toLowerCase().includes("238") || model?.toLowerCase().includes("jet"));
  const isRecon = Boolean(
    model?.toLowerCase().includes("recon") ||
    model?.toLowerCase().includes("supercam") ||
    model?.toLowerCase().includes("orlan") ||
    model?.toLowerCase().includes("zala")
  );

  if (isRecon) {
    // Orlan-10 / Supercam S350 — high-aspect straight wing ISR UAV
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 5;

    // Fuselage pod (flat belly, rounded top)
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.moveTo(-size * 0.13, -size * 0.72);
    ctx.quadraticCurveTo(-size * 0.17, 0, -size * 0.14, size * 0.55);
    ctx.lineTo(size * 0.14, size * 0.55);
    ctx.quadraticCurveTo(size * 0.17, 0, size * 0.13, -size * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // High-aspect straight wings
    ctx.fillStyle = "#1e3a5f";
    ctx.beginPath();
    ctx.moveTo(-size * 0.15, -size * 0.08);
    ctx.lineTo(-size * 1.05, -size * 0.04);
    ctx.lineTo(-size * 1.05, size * 0.18);
    ctx.lineTo(-size * 0.15, size * 0.14);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(size * 0.15, -size * 0.08);
    ctx.lineTo(size * 1.05, -size * 0.04);
    ctx.lineTo(size * 1.05, size * 0.18);
    ctx.lineTo(size * 0.15, size * 0.14);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Pusher prop at tail
    const reA = (timeMs / 12) % 360;
    ctx.save();
    ctx.translate(0, size * 0.55);
    ctx.rotate((reA * Math.PI) / 180);
    ctx.strokeStyle = "rgba(148,163,184,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-size * 0.22, 0); ctx.lineTo(size * 0.22, 0);
    ctx.moveTo(0, -size * 0.22); ctx.lineTo(0, size * 0.22);
    ctx.stroke();
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // V-tail
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-size * 0.28, size * 0.42);
    ctx.lineTo(0, size * 0.30);
    ctx.lineTo(size * 0.28, size * 0.42);
    ctx.stroke();

    // EO/IR sensor ball under nose
    ctx.fillStyle = "#0ea5e9";
    ctx.beginPath();
    ctx.arc(0, -size * 0.68, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#bae6fd";
    ctx.beginPath();
    ctx.arc(-0.6, -size * 0.68 - 0.6, 1.2, 0, Math.PI * 2);
    ctx.fill();

  } else if (isJet) {
    // Shahed-238 — turbojet delta (stealth matte black)
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 6;

    // Main delta wing body
    ctx.fillStyle = "#09090b";
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.95);
    ctx.lineTo(size * 0.78, size * 0.52);
    ctx.lineTo(size * 0.78, size * 0.70);
    ctx.lineTo(size * 0.60, size * 0.70);
    ctx.lineTo(size * 0.16, size * 0.47);
    ctx.lineTo(size * 0.11, size * 0.64);
    ctx.lineTo(-size * 0.11, size * 0.64);
    ctx.lineTo(-size * 0.16, size * 0.47);
    ctx.lineTo(-size * 0.60, size * 0.70);
    ctx.lineTo(-size * 0.78, size * 0.70);
    ctx.lineTo(-size * 0.78, size * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // Fuselage spine
    ctx.fillStyle = "#1c1917";
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.10, size * 0.12, size * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wing panel lines
    ctx.strokeStyle = "rgba(251,191,36,0.25)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.55); ctx.lineTo(size * 0.62, size * 0.44);
    ctx.moveTo(0, -size * 0.55); ctx.lineTo(-size * 0.62, size * 0.44);
    ctx.stroke();

    // Jet exhaust plume (animated)
    const plumeLen = size * (0.28 + Math.sin(timeMs / 16) * 0.09);
    const grad = ctx.createLinearGradient(0, size * 0.64, 0, size * 0.64 + plumeLen);
    grad.addColorStop(0, "rgba(251,191,36,0.95)");
    grad.addColorStop(0.4, "rgba(239,68,68,0.7)");
    grad.addColorStop(1, "rgba(239,68,68,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-size * 0.09, size * 0.64);
    ctx.lineTo(0, size * 0.64 + plumeLen);
    ctx.lineTo(size * 0.09, size * 0.64);
    ctx.closePath();
    ctx.fill();

    // Wingtip fins
    ctx.fillStyle = "#27272a";
    ctx.fillRect(-size * 0.78, size * 0.46, 2.5, size * 0.24);
    ctx.fillRect(size * 0.78 - 2.5, size * 0.46, 2.5, size * 0.24);
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(-size * 0.78, size * 0.46, 2.5, size * 0.08);
    ctx.fillRect(size * 0.78 - 2.5, size * 0.46, 2.5, size * 0.08);

    // Nose glint
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, -size * 0.88, 1.8, 0, Math.PI * 2);
    ctx.fill();

  } else {
    // Shahed-136 — pusher-prop kamikaze delta (most common target)
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;

    // Delta wing (RAM-coated dark graphite)
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.95);  // Nose radome
    ctx.lineTo(size * 0.76, size * 0.48);  // Right wingtip
    ctx.lineTo(size * 0.76, size * 0.65);
    ctx.lineTo(size * 0.62, size * 0.65);
    ctx.lineTo(size * 0.16, size * 0.45);
    ctx.lineTo(size * 0.12, size * 0.58);
    ctx.lineTo(-size * 0.12, size * 0.58);
    ctx.lineTo(-size * 0.16, size * 0.45);
    ctx.lineTo(-size * 0.62, size * 0.65);
    ctx.lineTo(-size * 0.76, size * 0.65);
    ctx.lineTo(-size * 0.76, size * 0.48);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // Upper fuselage fairing / spine
    ctx.fillStyle = "#334155";
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.10, size * 0.13, size * 0.50, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(239,68,68,0.5)";
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // Wing structural ribs
    ctx.strokeStyle = "rgba(148,163,184,0.30)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.50); ctx.lineTo(size * 0.60, size * 0.42);
    ctx.moveTo(0, -size * 0.50); ctx.lineTo(-size * 0.60, size * 0.42);
    ctx.moveTo(0, -size * 0.20); ctx.lineTo(size * 0.42, size * 0.38);
    ctx.moveTo(0, -size * 0.20); ctx.lineTo(-size * 0.42, size * 0.38);
    ctx.stroke();

    // Winglet vertical fins (white + red tip)
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(-size * 0.76, size * 0.42, 2.5, size * 0.23);
    ctx.fillRect(size * 0.76 - 2.5, size * 0.42, 2.5, size * 0.23);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(-size * 0.76, size * 0.42, 2.5, size * 0.08);
    ctx.fillRect(size * 0.76 - 2.5, size * 0.42, 2.5, size * 0.08);

    // Nose guidance radome
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, -size * 0.88, 2.0, 0, Math.PI * 2);
    ctx.fill();

    // MD-550 pusher propeller (spinning animation)
    const propAngle = (timeMs / 9) % 360;
    ctx.save();
    ctx.translate(0, size * 0.58);
    ctx.rotate((propAngle * Math.PI) / 180);
    // 3-blade prop
    for (let b = 0; b < 3; b++) {
      ctx.fillStyle = "rgba(226,232,240,0.88)";
      ctx.beginPath();
      ctx.ellipse(0, -size * 0.18, size * 0.04, size * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate((120 * Math.PI) / 180);
    }
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
};


const drawMissileSilhouette = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number,
  color: string,
  timeMs: number = 0
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);

  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 6;

  // Main fuselage — Kh-101 narrow ogive torpedo body
  const bodyGrad = ctx.createLinearGradient(-size * 0.18, 0, size * 0.18, 0);
  bodyGrad.addColorStop(0, "#1e293b");
  bodyGrad.addColorStop(0.35, "#334155");
  bodyGrad.addColorStop(0.65, "#475569");
  bodyGrad.addColorStop(1, "#1e293b");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.02);       // Ogive nose tip
  ctx.bezierCurveTo(size * 0.06, -size * 0.9, size * 0.17, -size * 0.7, size * 0.17, -size * 0.45);
  ctx.lineTo(size * 0.17, size * 0.55);
  ctx.bezierCurveTo(size * 0.17, size * 0.72, size * 0.09, size * 0.78, 0, size * 0.78);
  ctx.bezierCurveTo(-size * 0.09, size * 0.78, -size * 0.17, size * 0.72, -size * 0.17, size * 0.55);
  ctx.lineTo(-size * 0.17, -size * 0.45);
  ctx.bezierCurveTo(-size * 0.17, -size * 0.7, -size * 0.06, -size * 0.9, 0, -size * 1.02);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Deployed folding cruise wing (port side)
  ctx.fillStyle = "#334155";
  ctx.beginPath();
  ctx.moveTo(-size * 0.17, -size * 0.18);
  ctx.lineTo(-size * 0.75, -size * 0.02);
  ctx.lineTo(-size * 0.75, size * 0.09);
  ctx.lineTo(-size * 0.17, size * 0.01);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Deployed folding cruise wing (starboard side)
  ctx.beginPath();
  ctx.moveTo(size * 0.17, -size * 0.18);
  ctx.lineTo(size * 0.75, -size * 0.02);
  ctx.lineTo(size * 0.75, size * 0.09);
  ctx.lineTo(size * 0.17, size * 0.01);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cruciform tail fins (4 fins — top view shows 2 laterals)
  ctx.fillStyle = "#1e293b";
  // Lateral fins
  ctx.beginPath();
  ctx.moveTo(-size * 0.17, size * 0.45);
  ctx.lineTo(-size * 0.44, size * 0.68);
  ctx.lineTo(-size * 0.44, size * 0.76);
  ctx.lineTo(-size * 0.12, size * 0.60);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(size * 0.17, size * 0.45);
  ctx.lineTo(size * 0.44, size * 0.68);
  ctx.lineTo(size * 0.44, size * 0.76);
  ctx.lineTo(size * 0.12, size * 0.60);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Turbofan exhaust nozzle glow
  const exGlow = size * (0.22 + Math.sin(timeMs / 14) * 0.06);
  const exhaustGrad = ctx.createRadialGradient(0, size * 0.78, 0, 0, size * 0.78, exGlow);
  exhaustGrad.addColorStop(0, "rgba(251,191,36,0.9)");
  exhaustGrad.addColorStop(0.4, "rgba(239,68,68,0.5)");
  exhaustGrad.addColorStop(1, "rgba(239,68,68,0)");
  ctx.fillStyle = exhaustGrad;
  ctx.beginPath();
  ctx.arc(0, size * 0.78, exGlow, 0, Math.PI * 2);
  ctx.fill();

  // Nose radome tip
  ctx.fillStyle = "#f0f9ff";
  ctx.beginPath();
  ctx.arc(0, -size * 0.96, 2, 0, Math.PI * 2);
  ctx.fill();

  // INS/GLONASS seeker dome highlight on body
  ctx.fillStyle = "rgba(56,189,248,0.4)";
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.70, size * 0.06, size * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};


const drawKabSilhouette = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number,
  color: string,
  _timeMs: number
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);

  // Soft warning tactical shadow
  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1;

  // 1. Deployed Folding Swept-Back Planar Wings (UMPK Pop-Out Wings)
  ctx.fillStyle = "#334155";
  ctx.beginPath();
  // Left wing
  ctx.moveTo(0, -size * 0.15);
  ctx.lineTo(-size * 1.15, size * 0.15);
  ctx.lineTo(-size * 1.15, size * 0.28);
  ctx.lineTo(-size * 0.18, size * 0.12);
  // Right wing
  ctx.lineTo(size * 0.18, size * 0.12);
  ctx.lineTo(size * 1.15, size * 0.28);
  ctx.lineTo(size * 1.15, size * 0.15);
  ctx.lineTo(0, -size * 0.15);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 1.0;
  ctx.stroke();

  // Wing leading edge high-visibility tactical chevrons
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(-size * 1.15, size * 0.15, size * 0.2, size * 0.1);
  ctx.fillRect(size * 0.95, size * 0.15, size * 0.2, size * 0.1);

  // 2. Heavy FAB-500 Bomb Casing (Aerodynamic Ogive Torpedo Body)
  ctx.fillStyle = "#1e293b"; // Heavy steel casing
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.98); // Bomb nose fuze tip
  ctx.lineTo(size * 0.18, -size * 0.65);
  ctx.lineTo(size * 0.22, 0);
  ctx.lineTo(size * 0.22, size * 0.45);
  ctx.lineTo(size * 0.12, size * 0.72); // Tapered boat tail
  ctx.lineTo(-size * 0.12, size * 0.72);
  ctx.lineTo(-size * 0.22, size * 0.45);
  ctx.lineTo(-size * 0.22, 0);
  ctx.lineTo(-size * 0.18, -size * 0.65);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 3. Dorsal UMPK module spine beam (балка кріплення модуля корекції)
  ctx.fillStyle = "#475569";
  ctx.fillRect(-size * 0.08, -size * 0.45, size * 0.16, size * 0.9);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = 0.8;
  ctx.strokeRect(-size * 0.08, -size * 0.45, size * 0.16, size * 0.9);

  // 4. Cruciform Tail Stabilizer Fins & Rudders
  ctx.beginPath();
  // Left fin
  ctx.moveTo(-size * 0.12, size * 0.62);
  ctx.lineTo(-size * 0.45, size * 0.82);
  ctx.lineTo(-size * 0.45, size * 0.90);
  ctx.lineTo(-size * 0.08, size * 0.78);
  // Right fin
  ctx.moveTo(size * 0.12, size * 0.62);
  ctx.lineTo(size * 0.45, size * 0.82);
  ctx.lineTo(size * 0.45, size * 0.90);
  ctx.lineTo(size * 0.08, size * 0.78);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // 5. Hardened Nose Fuze Pin (with bright targeting glint)
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -size * 0.95, 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

const drawFpvSilhouette = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number,
  color: string,
  timeMs: number
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);

  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.shadowBlur = 4;

  // 1. Carbon Fiber X-Frame Diagonal Arms
  const armSpan = size * 0.72;
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  // Front-left to rear-right
  ctx.moveTo(-armSpan, -armSpan);
  ctx.lineTo(armSpan, armSpan);
  // Front-right to rear-left
  ctx.moveTo(armSpan, -armSpan);
  ctx.lineTo(-armSpan, armSpan);
  ctx.stroke();

  // 2. Under-slung Munition (PG-7V rocket / HE charge)
  ctx.fillStyle = "#475569";
  ctx.beginPath();
  ctx.ellipse(0, size * 0.05, size * 0.15, size * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f43f5e";
  ctx.lineWidth = 1.0;
  ctx.stroke();

  // 3. Central Electronics Body & LiPo Battery
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(-size * 0.22, -size * 0.28, size * 0.44, size * 0.56);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-size * 0.22, -size * 0.28, size * 0.44, size * 0.56);

  // LiPo battery straps
  ctx.fillStyle = "#f59e0b";
  ctx.fillRect(-size * 0.18, -size * 0.12, size * 0.36, size * 0.08);

  // 4. Four High-Speed Spinning Propellers (Animated discs)
  const propRadius = size * 0.32;
  const propAngle = (timeMs / 8) % 360;
  const motorPositions = [
    [-armSpan, -armSpan], // Front-Left
    [armSpan, -armSpan],  // Front-Right
    [-armSpan, armSpan],  // Rear-Left
    [armSpan, armSpan]    // Rear-Right
  ];

  for (let i = 0; i < motorPositions.length; i++) {
    const [mx, my] = motorPositions[i];

    // Motor bell
    ctx.fillStyle = "#64748b";
    ctx.beginPath();
    ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Blurred rotor disk
    ctx.beginPath();
    ctx.arc(mx, my, propRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(217, 70, 239, 0.18)";
    ctx.fill();
    ctx.strokeStyle = "rgba(217, 70, 239, 0.45)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Spinning 3-blade prop lines
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(((propAngle * (i % 2 === 0 ? 1 : -1) + i * 45) * Math.PI) / 180);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.2;
    for (let b = 0; b < 3; b++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -propRadius);
      ctx.stroke();
      ctx.rotate((120 * Math.PI) / 180);
    }
    ctx.restore();
  }

  // 5. Front-Facing FPV Optical Camera Lens (pointing forward!)
  ctx.fillStyle = "#0284c7";
  ctx.beginPath();
  ctx.arc(0, -size * 0.34, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#38bdf8";
  ctx.beginPath();
  ctx.arc(0, -size * 0.34, 1.4, 0, Math.PI * 2);
  ctx.fill();

  // 6. Rear ELRS/VTX Antenna Stub
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.28);
  ctx.lineTo(0, size * 0.48);
  ctx.stroke();

  ctx.restore();
};

const drawAircraftSilhouette = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number,
  color: string,
  timeMs: number
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);

  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 7;

  // Fuselage body with gradient shading (dark top, lighter belly)
  const fuseGrad = ctx.createLinearGradient(-size * 0.16, 0, size * 0.16, 0);
  fuseGrad.addColorStop(0, "#1e293b");
  fuseGrad.addColorStop(0.4, "#334155");
  fuseGrad.addColorStop(0.6, "#475569");
  fuseGrad.addColorStop(1, "#1e293b");
  ctx.fillStyle = fuseGrad;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.96);         // Nose radome tip
  ctx.bezierCurveTo(size * 0.08, -size * 0.78, size * 0.14, -size * 0.52, size * 0.14, -size * 0.18);
  ctx.lineTo(size * 0.14, size * 0.72);
  ctx.bezierCurveTo(size * 0.14, size * 0.84, size * 0.06, size * 0.90, 0, size * 0.88);
  ctx.bezierCurveTo(-size * 0.06, size * 0.90, -size * 0.14, size * 0.84, -size * 0.14, size * 0.72);
  ctx.lineTo(-size * 0.14, -size * 0.18);
  ctx.bezierCurveTo(-size * 0.14, -size * 0.52, -size * 0.08, -size * 0.78, 0, -size * 0.96);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // Swept main wings (delta/cropped delta — Su-25/MiG style)
  ctx.fillStyle = "#1e3a5f";
  // Right wing
  ctx.beginPath();
  ctx.moveTo(size * 0.14, -size * 0.05);
  ctx.lineTo(size * 0.90, size * 0.32);
  ctx.lineTo(size * 0.90, size * 0.42);
  ctx.lineTo(size * 0.38, size * 0.42);
  ctx.lineTo(size * 0.14, size * 0.28);
  ctx.closePath();
  ctx.fill();
  // Left wing
  ctx.beginPath();
  ctx.moveTo(-size * 0.14, -size * 0.05);
  ctx.lineTo(-size * 0.90, size * 0.32);
  ctx.lineTo(-size * 0.90, size * 0.42);
  ctx.lineTo(-size * 0.38, size * 0.42);
  ctx.lineTo(-size * 0.14, size * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // Horizontal stabilizers (tail planes)
  ctx.fillStyle = "#1e3a5f";
  ctx.beginPath();
  ctx.moveTo(size * 0.14, size * 0.62);
  ctx.lineTo(size * 0.52, size * 0.82);
  ctx.lineTo(size * 0.52, size * 0.88);
  ctx.lineTo(size * 0.14, size * 0.76);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-size * 0.14, size * 0.62);
  ctx.lineTo(-size * 0.52, size * 0.82);
  ctx.lineTo(-size * 0.52, size * 0.88);
  ctx.lineTo(-size * 0.14, size * 0.76);
  ctx.closePath();
  ctx.fill();

  // Wing structural panel lines
  ctx.strokeStyle = "rgba(148,163,184,0.25)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(size * 0.14, size * 0.10); ctx.lineTo(size * 0.70, size * 0.36);
  ctx.moveTo(-size * 0.14, size * 0.10); ctx.lineTo(-size * 0.70, size * 0.36);
  ctx.stroke();

  // Cockpit canopy (fighter-style bubble)
  ctx.fillStyle = "#7dd3fc";
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.62, size * 0.08, size * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.ellipse(-size * 0.025, -size * 0.68, size * 0.035, size * 0.10, 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Twin engine nacelles (under rear fuselage)
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.rect(-size * 0.36, size * 0.30, size * 0.12, size * 0.32);
  ctx.fill();
  ctx.beginPath();
  ctx.rect(size * 0.24, size * 0.30, size * 0.12, size * 0.32);
  ctx.fill();

  // Afterburner glow from both engines
  const abFlicker = Math.sin(timeMs / 30) * 0.12 + 0.88;
  const abLen = size * (0.18 + Math.sin(timeMs / 22) * 0.05);
  const abGradL = ctx.createLinearGradient(-size * 0.30, size * 0.62, -size * 0.30, size * 0.62 + abLen);
  abGradL.addColorStop(0, `rgba(251,191,36,${abFlicker})`);
  abGradL.addColorStop(0.45, `rgba(239,68,68,${abFlicker * 0.65})`);
  abGradL.addColorStop(1, "rgba(239,68,68,0)");
  ctx.fillStyle = abGradL;
  ctx.beginPath();
  ctx.moveTo(-size * 0.36, size * 0.62); ctx.lineTo(-size * 0.30, size * 0.62 + abLen); ctx.lineTo(-size * 0.24, size * 0.62);
  ctx.closePath(); ctx.fill();
  const abGradR = ctx.createLinearGradient(size * 0.30, size * 0.62, size * 0.30, size * 0.62 + abLen);
  abGradR.addColorStop(0, `rgba(251,191,36,${abFlicker})`);
  abGradR.addColorStop(0.45, `rgba(239,68,68,${abFlicker * 0.65})`);
  abGradR.addColorStop(1, "rgba(239,68,68,0)");
  ctx.fillStyle = abGradR;
  ctx.beginPath();
  ctx.moveTo(size * 0.24, size * 0.62); ctx.lineTo(size * 0.30, size * 0.62 + abLen); ctx.lineTo(size * 0.36, size * 0.62);
  ctx.closePath(); ctx.fill();

  // Nav lights: Port=red, Starboard=green
  ctx.fillStyle = "#ef4444";
  ctx.beginPath(); ctx.arc(-size * 0.90, size * 0.37, 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#22c55e";
  ctx.beginPath(); ctx.arc(size * 0.90, size * 0.37, 2, 0, Math.PI * 2); ctx.fill();

  // Anti-collision strobe
  if (timeMs % 900 < 110) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(0, size * 0.86, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
};

const drawHelicopterSilhouette = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number,
  color: string,
  timeMs: number
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);

  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 6;

  // --- Main fuselage body (Ka-52 / Mi-28 attack helo shape) ---
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.62);           // Nose tip
  ctx.bezierCurveTo(size * 0.22, -size * 0.50, size * 0.28, -size * 0.20, size * 0.26, size * 0.18);
  ctx.lineTo(size * 0.20, size * 0.45);
  ctx.lineTo(0, size * 0.50);
  ctx.lineTo(-size * 0.20, size * 0.45);
  ctx.lineTo(-size * 0.26, size * 0.18);
  ctx.bezierCurveTo(-size * 0.28, -size * 0.20, -size * 0.22, -size * 0.50, 0, -size * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Tail boom (extends rearward)
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.moveTo(-size * 0.08, size * 0.44);
  ctx.lineTo(-size * 0.08, size * 0.96);
  ctx.lineTo(size * 0.08, size * 0.96);
  ctx.lineTo(size * 0.08, size * 0.44);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // Tail fin (horizontal)
  ctx.fillStyle = "#334155";
  ctx.beginPath();
  ctx.moveTo(-size * 0.08, size * 0.90);
  ctx.lineTo(-size * 0.38, size * 0.88);
  ctx.lineTo(-size * 0.38, size * 0.96);
  ctx.lineTo(-size * 0.08, size * 0.96);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(size * 0.08, size * 0.90);
  ctx.lineTo(size * 0.32, size * 0.88);
  ctx.lineTo(size * 0.32, size * 0.96);
  ctx.lineTo(size * 0.08, size * 0.96);
  ctx.closePath();
  ctx.fill();

  // Tail rotor (spinning)
  const tailRotorAngle = (timeMs / 8) % 360;
  ctx.save();
  ctx.translate(-size * 0.38, size * 0.92);
  ctx.rotate((tailRotorAngle * Math.PI) / 180);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.4;
  for (let b = 0; b < 3; b++) {
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, -size * 0.20); ctx.stroke();
    ctx.rotate((120 * Math.PI) / 180);
  }
  ctx.restore();

  // Stub wings with hardpoints (weapons rails)
  ctx.fillStyle = "#334155";
  // Right stub wing
  ctx.beginPath();
  ctx.moveTo(size * 0.26, -size * 0.05);
  ctx.lineTo(size * 0.64, -size * 0.02);
  ctx.lineTo(size * 0.64, size * 0.10);
  ctx.lineTo(size * 0.26, size * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // Left stub wing
  ctx.beginPath();
  ctx.moveTo(-size * 0.26, -size * 0.05);
  ctx.lineTo(-size * 0.64, -size * 0.02);
  ctx.lineTo(-size * 0.64, size * 0.10);
  ctx.lineTo(-size * 0.26, size * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Weapons pods on wingtips
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(size * 0.60, -size * 0.01, size * 0.12, size * 0.07);
  ctx.fillRect(-size * 0.72, -size * 0.01, size * 0.12, size * 0.07);

  // Bubble cockpit / armored nose
  ctx.fillStyle = "#7dd3fc";
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.42, size * 0.15, size * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.beginPath();
  ctx.ellipse(-size * 0.04, -size * 0.48, size * 0.06, size * 0.10, 0.25, 0, Math.PI * 2);
  ctx.fill();

  // Main rotor system (top-down view: spinning disc)
  const rotorAngle = (timeMs / 14) % 360;
  ctx.save();
  ctx.translate(0, -size * 0.08);
  ctx.rotate((rotorAngle * Math.PI) / 180);
  // Rotor disc motion blur ring
  ctx.strokeStyle = "rgba(203,213,225,0.25)";
  ctx.lineWidth = size * 0.12;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  // 5-blade rotor
  ctx.strokeStyle = "rgba(255,255,255,0.80)";
  ctx.lineWidth = 2;
  for (let b = 0; b < 5; b++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -size * 0.92);
    ctx.stroke();
    ctx.rotate((72 * Math.PI) / 180);
  }
  // Rotor hub
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
};

const drawUncertaintyCone = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  lengthPx: number,
  spreadAngleDeg = 24
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((heading * Math.PI) / 180);

  const halfSpread = (spreadAngleDeg * Math.PI) / 180;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.sin(halfSpread) * lengthPx, -Math.cos(halfSpread) * lengthPx);
  ctx.arc(0, 0, lengthPx, -Math.PI / 2 + halfSpread, -Math.PI / 2 - halfSpread, true);
  ctx.closePath();

  ctx.fillStyle = "rgba(239, 68, 68, 0.14)";
  ctx.fill();
  ctx.strokeStyle = "rgba(239, 68, 68, 0.45)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.restore();
};

const drawTacticalSelectionHalo = (
  _ctx: CanvasRenderingContext2D,
  _x: number,
  _y: number,
  _timeMs: number,
  _color = "#38bdf8"
) => {
  // Clean display: zero circles, brackets or boxes around selected targets
};

const drawSelectedLocationBeacon = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  _timeMs: number
) => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#38bdf8";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
};

const drawUserHomeBeacon = (
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  loc: { lat: number; lon: number },
  _name: string | undefined,
  _timeMs: number,
  width: number,
  height: number
) => {
  const pt = map.project([loc.lon, loc.lat]);
  if (pt.x < -60 || pt.x > width + 60 || pt.y < -60 || pt.y > height + 60) {
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#38bdf8";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
};

interface PillRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const doesPillOverlap = (r1: PillRect, r2: PillRect): boolean =>
  !(r1.x + r1.w < r2.x - 4 || r2.x + r2.w < r1.x - 4 || r1.y + r1.h < r2.y - 4 || r2.y + r2.h < r1.y - 4);

const drawTacticalClusterNode = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  color: string
) => {
  ctx.save();
  const radius = Math.min(16, 10 + Math.log2(count) * 2.2);
  ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Subtle outer radar pulse ring
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = `${color}88`;
  ctx.beginPath();
  ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 9px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(count), x, y + 0.5);
  ctx.restore();
};

const drawCivilAviationCluster = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number
) => {
  ctx.save();
  const radius = Math.min(15, 10 + Math.log2(count) * 1.8);
  ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
  ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
  ctx.lineWidth = 1.0;

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#94a3b8";
  ctx.font = "bold 9px 'JetBrains Mono', monospace, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`✈ ${count}`, x, y + 0.5);
  ctx.restore();
};

const drawCivilAviationMuted = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  screenHeadingDeg: number
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((screenHeadingDeg * Math.PI) / 180);
  ctx.fillStyle = "#94a3b8";
  ctx.globalAlpha = 0.32;
  ctx.beginPath();
  ctx.moveTo(0, -5);
  ctx.lineTo(3.5, 4);
  ctx.lineTo(0, 2);
  ctx.lineTo(-3.5, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawMilitaryCalloutPill = (
  ctx: CanvasRenderingContext2D,
  targetX: number,
  targetY: number,
  modelName: string,
  speedKmh: number,
  altStr: string,
  color: string,
  isThreat: boolean,
  showAlt: boolean,
  placedBoxes: PillRect[]
) => {
  ctx.save();
  const ratio = window.devicePixelRatio || 1;
  const screenW = ctx.canvas.width / ratio;
  const screenH = ctx.canvas.height / ratio;

  const text = showAlt
    ? `${modelName} ${speedKmh} км/год ${altStr}`
    : `${modelName} ${speedKmh} км/год`;

  ctx.font = "bold 10px Inter, -apple-system, system-ui, sans-serif";
  const metrics = ctx.measureText(text);
  const pillW = Math.max(70, Math.ceil(metrics.width) + 16);
  const pillH = 18;

  // Anti-collision candidate slots prioritizing screen interior to prevent clipping
  const isRightHalf = targetX > screenW * 0.55;
  const candidates: Array<{ x: number; y: number }> = isRightHalf
    ? [
        { x: targetX - pillW - 14, y: Math.round(targetY - pillH / 2) }, // Left
        { x: targetX - pillW - 14, y: Math.round(targetY - pillH / 2 - 20) }, // Left-Up
        { x: targetX - pillW - 14, y: Math.round(targetY - pillH / 2 + 20) }, // Left-Down
        { x: Math.round(targetX - pillW / 2), y: targetY - pillH - 12 }, // Top
        { x: Math.round(targetX - pillW / 2), y: targetY + 14 }, // Bottom
        { x: targetX + 14, y: Math.round(targetY - pillH / 2) }, // Right
        { x: targetX + 14, y: Math.round(targetY - pillH / 2 - 20) }, // Right-Up
        { x: targetX + 14, y: Math.round(targetY - pillH / 2 + 20) } // Right-Down
      ]
    : [
        { x: targetX + 14, y: Math.round(targetY - pillH / 2) }, // Right
        { x: targetX + 14, y: Math.round(targetY - pillH / 2 - 20) }, // Right-Up
        { x: targetX + 14, y: Math.round(targetY - pillH / 2 + 20) }, // Right-Down
        { x: Math.round(targetX - pillW / 2), y: targetY - pillH - 12 }, // Top
        { x: Math.round(targetX - pillW / 2), y: targetY + 14 }, // Bottom
        { x: targetX - pillW - 14, y: Math.round(targetY - pillH / 2) }, // Left
        { x: targetX - pillW - 14, y: Math.round(targetY - pillH / 2 - 20) }, // Left-Up
        { x: targetX - pillW - 14, y: Math.round(targetY - pillH / 2 + 20) } // Left-Down
      ];

  let chosenX = candidates[0].x;
  let chosenY = candidates[0].y;
  let foundNonColliding = false;

  for (const cand of candidates) {
    const clampedX = Math.max(6, Math.min(screenW - pillW - 6, cand.x));
    const clampedY = Math.max(6, Math.min(screenH - pillH - 6, cand.y));
    const testRect: PillRect = { x: clampedX, y: clampedY, w: pillW, h: pillH };

    const collides = placedBoxes.some((b) => doesPillOverlap(testRect, b));
    if (!collides) {
      chosenX = clampedX;
      chosenY = clampedY;
      foundNonColliding = true;
      break;
    }
  }

  // If all candidates collide with existing pills, do not draw overlapping clutter
  if (!foundNonColliding) {
    if (placedBoxes.length > 0) {
      ctx.restore();
      return;
    }
    chosenX = Math.max(6, Math.min(screenW - pillW - 6, candidates[0].x));
    chosenY = Math.max(6, Math.min(screenH - pillH - 6, candidates[0].y));
  }

  placedBoxes.push({ x: chosenX, y: chosenY, w: pillW, h: pillH });

  const px = chosenX;
  const py = chosenY;

  // Background glass pill
  ctx.fillStyle = "rgba(7, 12, 22, 0.94)";
  ctx.strokeStyle = isThreat ? "rgba(239, 68, 68, 0.88)" : "rgba(56, 189, 248, 0.78)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.roundRect(px, py, pillW, pillH, 4);
  ctx.fill();
  ctx.stroke();

  // Subtle lead connector line from target to pill
  ctx.strokeStyle = isThreat ? "rgba(239, 68, 68, 0.45)" : "rgba(56, 189, 248, 0.35)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  if (px > targetX) {
    ctx.moveTo(targetX + 16, targetY);
    ctx.lineTo(px, py + 9);
  } else if (px + pillW < targetX) {
    ctx.moveTo(targetX - 16, targetY);
    ctx.lineTo(px + pillW, py + 9);
  } else {
    ctx.moveTo(targetX, targetY > py ? targetY - 16 : targetY + 16);
    ctx.lineTo(px + pillW / 2, py + (targetY > py ? pillH : 0));
  }
  ctx.stroke();

  // Crisp high-contrast typography
  ctx.fillStyle = "#f8fafc";
  ctx.textBaseline = "middle";
  ctx.fillText(text, px + 8, py + 9.5);

  ctx.restore();
};


const syncWeatherLayer = async (map: maplibregl.Map, visible: boolean) => {
  try {
    if (!map || !map.isStyleLoaded()) return;

    if (!visible) {
      if (map.getLayer("rainviewer-radar-layer")) {
        map.setLayoutProperty("rainviewer-radar-layer", "visibility", "none");
      }
      return;
    }

    const tileUrl = await getLiveWeatherRadarTileUrl();
    if (!tileUrl || !map || !map.isStyleLoaded()) return;

    if (!map.getSource("rainviewer-radar")) {
      map.addSource("rainviewer-radar", {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 6 // RainViewer only serves radar up to zoom 6/7; higher requests return "Zoom Level Not Supported" tiles!
      });
    }

    if (!map.getLayer("rainviewer-radar-layer")) {
      const beforeLayer = map.getLayer("esri-reference-layer") ? "esri-reference-layer" : undefined;
      map.addLayer(
        {
          id: "rainviewer-radar-layer",
          type: "raster",
          source: "rainviewer-radar",
          maxzoom: 7, // Automatically hides at zoom >= 7 so detailed city views are 100% crystal clear without error tiles!
          paint: {
            "raster-opacity": 0.45,
            "raster-fade-duration": 200
          },
          layout: {
            visibility: "visible"
          }
        },
        beforeLayer
      );
    } else {
      map.setLayoutProperty(
        "rainviewer-radar-layer",
        "visibility",
        "visible"
      );
    }
  } catch {
    // Graceful fallback if weather radar tile fails
  }
};

const UKR_TO_ISO: Record<string, string> = {
  "дніпро": "UA-12",
  "донец": "UA-14",
  "запорі": "UA-23",
  "луган": "UA-09",
  "микола": "UA-48",
  "одес": "UA-51",
  "харків": "UA-63",
  "чернігів": "UA-74",
  "сум": "UA-59",
  "полтав": "UA-53",
  "черкас": "UA-71",
  "кіровоград": "UA-35",
  "кропивниц": "UA-35",
  "херсон": "UA-65",
  "вінниц": "UA-05",
  "житомир": "UA-18",
  "хмельниц": "UA-68",
  "рівн": "UA-56",
  "волин": "UA-07",
  "терноп": "UA-61",
  "івано-франків": "UA-26",
  "чернів": "UA-77",
  "львів": "UA-46",
  "закарпат": "UA-21",
  "крим": "UA-43",
  "севастопол": "UA-40"
};

export function mapAlertToIso(alertName: string): string | null {
  if (!alertName) return null;
  const clean = alertName.toLowerCase().replace("область", "").replace("обл.", "").trim();
  if (clean.includes("київськ")) return "UA-32";
  if (clean.includes("київ")) return "UA-30";
  for (const [k, iso] of Object.entries(UKR_TO_ISO)) {
    if (clean.includes(k)) return iso;
  }
  return null;
}

export const syncUkraineAlerts = (
  map: maplibregl.Map,
  activeAlerts: string[] = [],
  showAlerts = true
) => {
  if (!map || !map.isStyleLoaded()) return;

  try {
    if (!map.getSource("ukraine-oblasts")) {
      map.addSource("ukraine-oblasts", {
        type: "geojson",
        data: "/ukraine-oblasts.geojson"
      });
    }

    const beforeLayerId = map.getLayer("frontline-glow") ? "frontline-glow" : undefined;

    // 1. Neutral administrative borders across Ukraine
    if (!map.getLayer("ukraine-oblasts-neutral-outline")) {
      map.addLayer(
        {
          id: "ukraine-oblasts-neutral-outline",
          type: "line",
          source: "ukraine-oblasts",
          paint: {
            "line-color": "rgba(255, 255, 255, 0.18)",
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 7, 0.8, 10, 1.2],
            "line-opacity": 0.08
          }
        },
        beforeLayerId
      );
    }

    // 2. Resolve active alert oblast ISO codes
    const activeIsos =
      showAlerts && activeAlerts && activeAlerts.length > 0
        ? Array.from(
            new Set(activeAlerts.map(mapAlertToIso).filter((iso): iso is string => Boolean(iso)))
          )
        : [];

    const alertFilter: any =
      activeIsos.length > 0
        ? ["in", ["get", "shapeISO"], ["literal", activeIsos]]
        : ["==", ["get", "shapeISO"], "___NONE___"];

    // 3. Tactical red ambient polygon fill for alarmed oblasts
    if (!map.getLayer("ukraine-alerts-fill")) {
      map.addLayer(
        {
          id: "ukraine-alerts-fill",
          type: "fill",
          source: "ukraine-oblasts",
          paint: {
            "fill-color": "#ef4444",
            "fill-opacity": 0.18
          },
          filter: alertFilter
        },
        beforeLayerId
      );
    } else {
      map.setFilter("ukraine-alerts-fill", alertFilter);
      map.setLayoutProperty("ukraine-alerts-fill", "visibility", showAlerts ? "visible" : "none");
    }

    // 4. Glowing red perimeter outline for alarmed oblasts
    if (!map.getLayer("ukraine-alerts-glow")) {
      map.addLayer(
        {
          id: "ukraine-alerts-glow",
          type: "line",
          source: "ukraine-oblasts",
          paint: {
            "line-color": "#ef4444",
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 4.0, 7, 6.0, 10, 8.0],
            "line-blur": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 7, 4.0, 10, 6.0],
            "line-opacity": 0.55
          },
          filter: alertFilter
        },
        beforeLayerId
      );
    } else {
      map.setFilter("ukraine-alerts-glow", alertFilter);
      map.setLayoutProperty("ukraine-alerts-glow", "visibility", showAlerts ? "visible" : "none");
    }

    // 5. Crisp tactical red border for alarmed oblasts
    if (!map.getLayer("ukraine-alerts-border")) {
      map.addLayer(
        {
          id: "ukraine-alerts-border",
          type: "line",
          source: "ukraine-oblasts",
          paint: {
            "line-color": "#ef4444",
            "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.4, 7, 2.0, 10, 2.6],
            "line-opacity": 0.85
          },
          filter: alertFilter
        },
        beforeLayerId
      );
    } else {
      map.setFilter("ukraine-alerts-border", alertFilter);
      map.setLayoutProperty("ukraine-alerts-border", "visibility", showAlerts ? "visible" : "none");
    }
  } catch {}
};

const syncUkraineBorders = (map: maplibregl.Map, showFrontline = true) => {
  if (!map || !map.isStyleLoaded()) return;
  try {
    // Completely remove any custom border lines drawn over real borders
    const customBorderLayers = [
      "world-borders-glow",
      "world-borders-line",
      "ukraine-real-glow",
      "ukraine-real-border"
    ];
    for (const id of customBorderLayers) {
      if (map.getLayer(id)) {
        try { map.removeLayer(id); } catch {}
      }
    }
    if (map.getSource("world-borders")) {
      try { map.removeSource("world-borders"); } catch {}
    }

    // Tactical Line of Contact / Frontline (ЛБЗ)
    if (!map.getSource("ukraine-frontline")) {
      map.addSource("ukraine-frontline", {
        type: "geojson",
        data: getFrontlineGeoJSON()
      });
    }

    if (!map.getLayer("frontline-glow")) {
      map.addLayer({
        id: "frontline-glow",
        type: "line",
        source: "ukraine-frontline",
        paint: {
          "line-color": "#ef4444",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 6.0, 8, 10.0, 12, 14.0],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 4, 3.0, 8, 5.0, 12, 7.0],
          "line-opacity": 0.85
        }
      });
    }

    if (!map.getLayer("frontline-dash")) {
      map.addLayer({
        id: "frontline-dash",
        type: "line",
        source: "ukraine-frontline",
        paint: {
          "line-color": "#dc2626",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.2, 8, 3.2, 12, 4.2],
          "line-opacity": 0.98
        }
      });
    }

    if (!map.getLayer("frontline-core")) {
      map.addLayer({
        id: "frontline-core",
        type: "line",
        source: "ukraine-frontline",
        paint: {
          "line-color": "#fef2f2",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.0, 8, 1.8, 12, 2.4],
          "line-opacity": 0.98
        }
      });
    }

    // Synchronize frontline visibility
    const frontlineVis = showFrontline ? "visible" : "none";
    for (const id of ["frontline-glow", "frontline-dash", "frontline-core"]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", frontlineVis);
      }
    }
  } catch {
    // Graceful fallback if borders already present or WebGL busy
  }
};

const drawTacticalImpactMarker = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isImpact: boolean,
  label: string,
  now: number,
  opacity = 1.0,
  showLabel = false,
  isSelected = false
) => {
  ctx.save();
  ctx.globalAlpha = Math.max(0.18, Math.min(1.0, opacity));
  const radius = isImpact ? 11 : 10;

  // 1. Tactical selection reticle
  if (isSelected) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    ctx.strokeStyle = isImpact ? "rgba(239, 68, 68, 0.95)" : "rgba(56, 189, 248, 0.95)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(x, y, radius + 4 + pulse * 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 2. Core tactical badge
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = isImpact ? "rgba(220, 38, 38, 0.95)" : "rgba(14, 116, 144, 0.95)";
  ctx.fill();
  ctx.strokeStyle = isImpact ? "#fca5a5" : "#bae6fd";
  ctx.lineWidth = isSelected ? 2.0 : 1.4;
  ctx.stroke();

  // 3. Central text symbol (no emojis)
  ctx.font = "bold 8.5px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(isImpact ? "!" : "ППО", x, y + 0.5);

  // 4. Tactical label pill (clean background, shown only when showLabel is true)
  if (showLabel) {
    const cleanLabel = label.replace(/[💥🛡️]/gu, "").trim();
    ctx.font = "bold 9px Inter, -apple-system, system-ui, sans-serif";
    const textW = ctx.measureText(cleanLabel).width;
    const pillW = textW + 12;
    const pillH = 16;
    const pillX = x - pillW / 2;
    const pillY = y + radius + 4;

    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.strokeStyle = isImpact ? "rgba(239, 68, 68, 0.7)" : "rgba(56, 189, 248, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, 3);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isImpact ? "#fecaca" : "#e0f2fe";
    ctx.fillText(cleanLabel, x, pillY + pillH / 2 + 0.5);
  }

  ctx.restore();
};

const drawSatelliteReconLayer = (
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  satellites: SatelliteTrack[],
  _now: number,
  width: number,
  height: number
) => {
  ctx.save();
  for (const sat of satellites) {
    const satPt = map.project([sat.lon, sat.lat]);

    // Draw only if within viewing margin
    if (satPt.x < -120 || satPt.x > width + 120 || satPt.y < -120 || satPt.y > height + 120) {
      continue;
    }

    // Sleek minimal satellite diamond marker
    ctx.save();
    ctx.translate(satPt.x, satPt.y);
    const sensorColor =
      sat.type === "sar_radar"
        ? "#c084fc"
        : sat.type === "thermal"
        ? "#fb923c"
        : sat.type === "atmospheric"
        ? "#34d399"
        : "#38bdf8";
    ctx.fillStyle = sensorColor;
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, 4);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Clean Earth Observation metadata without emojis
    const typeLabel =
      sat.type === "sar_radar"
        ? "SAR"
        : sat.type === "thermal"
        ? "Thermal"
        : sat.type === "atmospheric"
        ? "Meteo"
        : "MSI";
    drawTextWithOutline(
      ctx,
      `${sat.name} [${typeLabel} • ${sat.resolutionMeters}м]`,
      satPt.x + 8,
      satPt.y - 4,
      sensorColor,
      "rgba(0, 0, 0, 0.95)",
      "9px Inter, monospace"
    );
  }
  ctx.restore();
};

const TARGET_COLORS: Record<string, string> = {
  uav: "#ef4444",
  munition: "#f97316",
  bomb: "#ef4444",
  fpv: "#d946ef",
  aircraft: "#38bdf8",
  helicopter: "#10b981",
  unknown: "#facc15"
};

interface PerimeterItem {
  id: string;
  type: string;
  edgeX: number;
  edgeY: number;
  angleRad: number;
  color: string;
  distKm: number;
  shortName: string;
  speedKmh: number;
}

const drawTacticalPerimeterIndicator = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angleRad: number,
  color: string,
  distKm: number,
  shortName: string
) => {
  ctx.save();
  ctx.translate(x, y);

  // 1. Directional tactical pointer
  ctx.rotate(angleRad);
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-6, -5);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 2. Compact distance badge (upright)
  ctx.rotate(-angleRad);
  ctx.font = "bold 9px Inter, system-ui, sans-serif";
  const label = `${distKm}км`;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(11, 18, 32, 0.85)";
  ctx.fillRect(-tw / 2 - 3, 7, tw + 6, 12);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(-tw / 2 - 3, 7, tw + 6, 12);
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(label, -tw / 2, 16);

  ctx.restore();
};

const drawAlertsLayer = (
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  activeAlerts: string[],
  _now: number,
  width: number,
  height: number
) => {
  if (!activeAlerts || activeAlerts.length === 0) return;
  const zoom = map.getZoom();
  // MapLibre renders full GPU-accelerated polygon fills; on canvas only draw tactical badges at zoom >= 5.5
  if (zoom < 5.5) return;

  ctx.save();
  for (const alertName of activeAlerts) {
    const clean = alertName.toLowerCase().replace("область", "").replace("обл.", "").trim();
    const match = LOCATIONS.find(
      (l) => l.name.toLowerCase().includes(clean) || l.region.toLowerCase().includes(clean)
    );
    if (!match) continue;

    const pt = map.project([match.lon, match.lat]);
    if (pt.x < 30 || pt.x > width - 30 || pt.y < 30 || pt.y > height - 30) {
      continue;
    }

    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    const text = "ТРИВОГА";
    const textWidth = ctx.measureText(text).width;
    const badgeW = textWidth + 14;
    const badgeH = 16;
    const rx = pt.x - badgeW / 2;
    const ry = pt.y - badgeH / 2;

    ctx.fillStyle = "rgba(220, 38, 38, 0.85)";
    ctx.beginPath();
    ctx.roundRect(rx, ry, badgeW, badgeH, 4);
    ctx.fill();

    ctx.strokeStyle = "rgba(254, 202, 202, 0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, pt.x, pt.y);
  }
  ctx.restore();
};

const drawSingleFirmsDot = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isSelected: boolean
) => {
  ctx.save();
  ctx.fillStyle = isSelected ? "rgba(249, 115, 22, 0.35)" : "rgba(249, 115, 22, 0.12)";
  ctx.beginPath();
  ctx.arc(x, y, isSelected ? 9 : 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f97316";
  ctx.beginPath();
  ctx.arc(x, y, isSelected ? 4 : 2.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#fed7aa";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
};

const drawFirmsHotspots = (
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  events: ClientUncertaintyEvent[],
  _now: number,
  width: number,
  height: number,
  selectedId?: string | null
) => {
  if (!events || events.length === 0) return;

  const zoom = map.getZoom();
  const shouldCluster = zoom < 6.8;

  const visible: Array<{ ev: ClientUncertaintyEvent; pt: { x: number; y: number } }> = [];
  for (const ev of events) {
    const pt = map.project([ev.lon, ev.lat]);
    if (pt.x >= -20 && pt.x <= width + 20 && pt.y >= -20 && pt.y <= height + 20) {
      visible.push({ ev, pt });
    }
  }

  if (visible.length === 0) return;

  if (shouldCluster && visible.length > 20) {
    const gridSize = 32;
    const grid: Record<string, { x: number; y: number; count: number; first: ClientUncertaintyEvent }> = {};
    for (const item of visible) {
      const gx = Math.floor(item.pt.x / gridSize);
      const gy = Math.floor(item.pt.y / gridSize);
      const key = `${gx}:${gy}`;
      if (!grid[key]) {
        grid[key] = { x: item.pt.x, y: item.pt.y, count: 1, first: item.ev };
      } else {
        grid[key].x = (grid[key].x * grid[key].count + item.pt.x) / (grid[key].count + 1);
        grid[key].y = (grid[key].y * grid[key].count + item.pt.y) / (grid[key].count + 1);
        grid[key].count++;
      }
    }
    for (const cell of Object.values(grid)) {
      if (cell.count > 1) {
        drawTacticalClusterNode(ctx, cell.x, cell.y, cell.count, "#f97316");
      } else {
        const isSel = cell.first.id === selectedId;
        drawSingleFirmsDot(ctx, cell.x, cell.y, isSel);
        if (isSel) {
          drawTextWithOutline(ctx, "🔥 NASA FIRMS", cell.x + 8, cell.y + 4, "#fed7aa");
        }
      }
    }
  } else {
    for (const item of visible) {
      const isSel = item.ev.id === selectedId;
      drawSingleFirmsDot(ctx, item.pt.x, item.pt.y, isSel);
      if (isSel) {
        drawTextWithOutline(ctx, `🔥 FIRMS (${(item.ev.confidence * 100).toFixed(0)}%)`, item.pt.x + 8, item.pt.y + 4, "#fed7aa");
      }
    }
  }
};

const drawUncertaintyEvents = (
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  events: ClientUncertaintyEvent[],
  now: number,
  width: number,
  height: number,
  selectedId?: string | null
) => {
  if (!events || events.length === 0) return;

  const pulse = 0.5 + 0.5 * Math.sin(now / 700);

  for (const ev of events) {
    const pt = map.project([ev.lon, ev.lat]);
    const offsetPt = map.project([ev.lon, ev.lat + (ev.uncertaintyRadius / 111139)]);
    const radiusPx = Math.max(16, Math.abs(offsetPt.y - pt.y));

    if (
      pt.x < -radiusPx ||
      pt.x > width + radiusPx ||
      pt.y < -radiusPx ||
      pt.y > height + radiusPx
    ) {
      continue;
    }

    ctx.save();
    const strokeColor = ev.sourceFamily === "acoustic" ? "rgba(250, 204, 21, 0.75)" : "rgba(56, 189, 248, 0.75)";
    const fillColor = ev.sourceFamily === "acoustic" ? "rgba(250, 204, 21, 0.06)" : "rgba(56, 189, 248, 0.06)";

    // Outer dashed ring
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = strokeColor;
    ctx.stroke();

    // Inner pulsed wave
    const innerRadius = radiusPx * (0.25 + 0.5 * pulse);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, innerRadius, 0, Math.PI * 2);
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = strokeColor.replace(/[\d.]+\)$/, `${0.2 + 0.25 * pulse})`);
    ctx.stroke();

    // Center cross
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pt.x - 4, pt.y); ctx.lineTo(pt.x + 4, pt.y);
    ctx.moveTo(pt.x, pt.y - 4); ctx.lineTo(pt.x, pt.y + 4);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Details strictly on selection: NO permanent label pills!
    if (ev.id === selectedId) {
      const kmLabel = (ev.uncertaintyRadius / 1000).toFixed(ev.uncertaintyRadius >= 10000 ? 0 : 1);
      const text = `${ev.label || "🎯 АКУСТИЧНИЙ СЕКТОР"} (±${kmLabel} км)`;
      drawTextWithOutline(ctx, text, pt.x - 20, pt.y - radiusPx - 6, "#facc15");
    }

    ctx.restore();
  }
};

export const MapView = ({
  packets,
  mapStyleUrl,
  location,
  confirmedLocation,
  filters,
  visionMode = "satellite",
  selectedTarget,
  selectedLocation,
  isPickingLocation,
  showDayNight = true,
  showWeather = true,
  showSatellites = true,
  showFrontline = true,
  showFirms = false,
  showAviation = true,
  showAlerts = true,
  showUncertainty = true,
  followingTargetId,
  onStopFollow,
  onMapReady,
  onSelectTarget,
  onSelectLocation,
  onPickLocation,
  impacts = [],
  selectedImpact,
  onSelectImpact,
  timelineOffsetSec = 0,
  performanceTier = "NORMAL",
  activeAlerts = []
}: MapViewProps) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const centeredRef = useRef(false);

  // Stable references to eliminate component re-render teardowns
  const packetsRef = useRef(packets);
  packetsRef.current = packets;

  const activeAlertsRef = useRef(activeAlerts);
  activeAlertsRef.current = activeAlerts;

  const spatialIndexRef = useRef<SpatialIndex<TrackPacket>>(new SpatialIndex<TrackPacket>(16));

  useEffect(() => {
    const items = packets.map((p) => ({
      minX: p[3],
      minY: p[2],
      maxX: p[3],
      maxY: p[2],
      item: p
    }));
    spatialIndexRef.current.clear();
    spatialIndexRef.current.load(items);
    renderRef.current?.();
  }, [packets]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) {
      syncUkraineAlerts(map, activeAlerts, showAlerts !== false);
    }
    renderRef.current?.();
  }, [activeAlerts, showAlerts]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) {
      syncUkraineBorders(map, showFrontline !== false);
    }
    renderRef.current?.();
  }, [showFrontline]);

  const timelineOffsetRef = useRef(timelineOffsetSec);
  timelineOffsetRef.current = timelineOffsetSec;

  const performanceTierRef = useRef(performanceTier);
  performanceTierRef.current = performanceTier;

  const lastFrameTimeRef = useRef(0);

  const impactsRef = useRef(impacts);
  impactsRef.current = impacts;

  const onSelectImpactRef = useRef(onSelectImpact);
  onSelectImpactRef.current = onSelectImpact;

  const selectedImpactRef = useRef(selectedImpact);
  selectedImpactRef.current = selectedImpact;

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const locationRef = useRef(location);
  locationRef.current = location;

  const confirmedLocationRef = useRef(confirmedLocation);
  confirmedLocationRef.current = confirmedLocation;

  const selectedTargetRef = useRef(selectedTarget);
  selectedTargetRef.current = selectedTarget;

  const selectedLocationRef = useRef(selectedLocation);
  selectedLocationRef.current = selectedLocation;

  const onSelectLocationRef = useRef(onSelectLocation);
  onSelectLocationRef.current = onSelectLocation;

  const followingTargetIdRef = useRef(followingTargetId);
  followingTargetIdRef.current = followingTargetId;

  const onStopFollowRef = useRef(onStopFollow);
  onStopFollowRef.current = onStopFollow;

  const isPickingLocationRef = useRef(isPickingLocation);
  isPickingLocationRef.current = isPickingLocation;

  const showDayNightRef = useRef(showDayNight);
  showDayNightRef.current = showDayNight;

  const showWeatherRef = useRef(showWeather);
  showWeatherRef.current = showWeather;

  const showSatellitesRef = useRef(showSatellites);
  showSatellitesRef.current = showSatellites;

  const showFrontlineRef = useRef(showFrontline);
  showFrontlineRef.current = showFrontline;

  const showFirmsRef = useRef(showFirms);
  showFirmsRef.current = showFirms;

  const showAviationRef = useRef(showAviation);
  showAviationRef.current = showAviation;

  const showAlertsRef = useRef(showAlerts);
  showAlertsRef.current = showAlerts;

  const showUncertaintyRef = useRef(showUncertainty);
  showUncertaintyRef.current = showUncertainty;

  const onSelectTargetRef = useRef(onSelectTarget);
  onSelectTargetRef.current = onSelectTarget;

  const onPickLocationRef = useRef(onPickLocation);
  onPickLocationRef.current = onPickLocation;

  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;

  const currentStyleRef = useRef<string | object | null>(null);
  const lastAppliedBrightnessRef = useRef<number>(-1);
  const lastBrightnessCheckRef = useRef<number>(0);
  const cachedRingsGeoRef = useRef<Array<{ radiusM: number; pts: Array<[number, number]> }>>([]);
  const lastLocRingRef = useRef<{ lat: number; lon: number } | null>(null);
  const cachedSatellitesRef = useRef<SatelliteTrack[]>([]);
  const lastSatCalcRef = useRef<number>(0);
  const renderRef = useRef<(() => void) | null>(null);
  const targetInterpRef = useRef<Record<string, { lat: number; lon: number; heading: number; speed: number; lastTime: number }>>({});
  const lastInterpPruneRef = useRef<number>(0);

  // Safe canvas resizer: ONLY updates dimensions if they have changed, never clears buffer on subpixel drift
  const resizeCanvasSafe = () => {
    const canvas = canvasRef.current;
    const container = mapContainerRef.current;
    if (!canvas || !container) return;

    const tierCfg = getTierConfig(performanceTierRef.current || "NORMAL");
    const ratio = Math.min(window.devicePixelRatio || 1, tierCfg.maxDpr);
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;

    const targetW = Math.round(w * ratio);
    const targetH = Math.round(h * ratio);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
  };

  // 1. Initialize MapLibre instance ONCE on mount
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const isSat = visionMode !== "tactical";
    const initialStyle = isSat ? SATELLITE_STYLE : mapStyleUrl;
    currentStyleRef.current = initialStyle;

    const isMobile = typeof window !== "undefined" && window.innerWidth < 600;
    // Operational Theater Viewport: Comprehensive view encompassing Ukraine and western border buffer
    const initialCenter: [number, number] = [28.8, 49.2];
    const initialZoom = isMobile ? 4.9 : 5.4;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: initialStyle,
      center: initialCenter,
      zoom: initialZoom,
      minZoom: 1.5,
      maxZoom: 18.0,
      pitch: 0, // Direct orthographic 2D top-down view (zero parallax perspective drift!)
      bearing: 0,
      maxPitch: 0,
      minPitch: 0,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
      antialias: true,
      attributionControl: false,
      fadeDuration: 0,
      maxTileCacheSize: 100
    });

    mapRef.current = map;
    (window as any).__eyeRadarMap = map;
    onMapReadyRef.current?.(map);

    // Hardware transform synchronization: attach overlay canvas inside MapLibre's canvas container
    // This guarantees that during pinch-to-zoom, the canvas transforms in hardware sync with the map!
    const canvas = canvasRef.current;
    const canvasContainer = map.getCanvasContainer();
    if (canvas && canvasContainer && canvas.parentElement !== canvasContainer) {
      canvasContainer.appendChild(canvas);
      canvas.style.position = "absolute";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "2";
    }

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      const clickX = e.point.x;
      const clickY = e.point.y;

      // 1. Check if an impact event was clicked
      if (impactsRef.current && impactsRef.current.length > 0) {
        let closestImpact: ImpactEvent | null = null;
        let minImpactDist = 26;
        for (const imp of impactsRef.current) {
          const pt = map.project([imp.lon, imp.lat]);
          const dist = Math.hypot(pt.x - clickX, pt.y - clickY);
          if (dist < minImpactDist) {
            minImpactDist = dist;
            closestImpact = imp;
          }
        }
        if (closestImpact) {
          onSelectImpactRef.current?.(closestImpact);
          window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
          return;
        }
      }

      // 2. Check if a target was clicked
      let closestTarget: TrackPacket | null = null;
      let minTargetDist = 36; // comfortable touch target radius for mobile
      for (const p of packetsRef.current) {
        const [id, , lat, lon] = p;
        const interp = targetInterpRef.current[id];
        const checkLat = interp ? interp.lat : lat;
        const checkLon = interp ? interp.lon : lon;
        const pt = map.project([checkLon, checkLat]);
        const dist = Math.hypot(pt.x - clickX, pt.y - clickY);
        if (dist < minTargetDist) {
          minTargetDist = dist;
          closestTarget = p;
        }
      }
      if (closestTarget) {
        onSelectTargetRef.current?.(closestTarget);
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
        return;
      }

      // 3. Check if a FIRMS hotspot was clicked
      const firms = trackStore.getFirmsEvents();
      let closestFirms: ClientUncertaintyEvent | null = null;
      let minFirmsDist = 24;
      for (const f of firms) {
        const pt = map.project([f.lon, f.lat]);
        const dist = Math.hypot(pt.x - clickX, pt.y - clickY);
        if (dist < minFirmsDist) {
          minFirmsDist = dist;
          closestFirms = f;
        }
      }
      if (closestFirms) {
        const firmsPacket: TrackPacket = [
          closestFirms.id,
          "thermal" as any,
          closestFirms.lat,
          closestFirms.lon,
          0,
          0,
          closestFirms.timestamp,
          closestFirms.confidence,
          closestFirms.uncertaintyRadius,
          "low" as any,
          0,
          "NASA FIRMS Thermal",
          "HOTSPOT"
        ];
        onSelectTargetRef.current?.(firmsPacket);
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
        return;
      }

      if (isPickingLocationRef.current) {
        onPickLocationRef.current?.(e.lngLat.lat, e.lngLat.lng);
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
        return;
      }

      onSelectLocationRef.current?.(e.lngLat.lat, e.lngLat.lng);
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
    };

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      const clickX = e.point.x;
      const clickY = e.point.y;
      let isHover = false;
      for (const p of packetsRef.current) {
        const [, , lat, lon] = p;
        const pt = map.project([lon, lat]);
        if (Math.hypot(pt.x - clickX, pt.y - clickY) < 22) {
          isHover = true;
          break;
        }
      }
      if (!isHover && impactsRef.current) {
        for (const imp of impactsRef.current) {
          const pt = map.project([imp.lon, imp.lat]);
          if (Math.hypot(pt.x - clickX, pt.y - clickY) < 22) {
            isHover = true;
            break;
          }
        }
      }
      map.getCanvas().style.cursor = isHover ? "pointer" : "";
    };

    const handleWindowResize = () => {
      map.resize();
      resizeCanvasSafe();
    };

    window.addEventListener("resize", handleWindowResize);
    window.Telegram?.WebApp?.onEvent?.("viewportChanged", handleWindowResize);

    const triggerInstantRedraw = () => {
      if (renderRef.current) {
        renderRef.current();
      }
    };

    const applyImmediateSolarLighting = (m: Map) => {
      const center = m.getCenter();
      const localSun = getLocalSolarStatus(center.lat, center.lng);
      const elev = localSun.elevationDeg;
      const satLayer = m.getLayer("satellite-tiles-layer") ? "satellite-tiles-layer" : m.getLayer("esri-satellite-layer") ? "esri-satellite-layer" : null;
      if (satLayer) {
        const nightFactor = Math.min(1, Math.max(0, -elev / 10));
        const targetBrightness = elev < 0 ? Math.max(0.35, 1.0 - nightFactor * 0.65) : 1.0;
        const targetSaturation = elev < 0 ? -0.45 * nightFactor : 0.0;
        const targetContrast = elev < 0 ? 0.25 * nightFactor : 0.0;
        lastAppliedBrightnessRef.current = targetBrightness;
        try {
          m.setPaintProperty(satLayer, "raster-brightness-max", targetBrightness);
          m.setPaintProperty(satLayer, "raster-saturation", targetSaturation);
          m.setPaintProperty(satLayer, "raster-contrast", targetContrast);
        } catch {}
      }
    };

    map.on("load", () => {
      resizeCanvasSafe();
      applyImmediateSolarLighting(map);
      if (performanceTierRef.current !== "LOW") { syncWeatherLayer(map, showWeatherRef.current !== false); }
      syncUkraineBorders(map, showFrontlineRef.current !== false);
      syncUkraineAlerts(map, activeAlertsRef.current, showAlertsRef.current !== false);
      const scaleControl = new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" });
      map.addControl(scaleControl, "bottom-right");
      triggerInstantRedraw();
    });
    map.on("styledata", () => {
      applyImmediateSolarLighting(map);
      syncUkraineBorders(map, showFrontlineRef.current !== false);
      syncUkraineAlerts(map, activeAlertsRef.current, showAlertsRef.current !== false);
      triggerInstantRedraw();
    });
    map.on("resize", () => {
      resizeCanvasSafe();
      triggerInstantRedraw();
    });
    map.on("render", triggerInstantRedraw);
    map.on("move", triggerInstantRedraw);
    map.on("zoom", triggerInstantRedraw);
    map.on("rotate", triggerInstantRedraw);
    map.on("pitch", triggerInstantRedraw);
    map.on("click", handleMapClick);
    map.on("mousemove", handleMouseMove);

    // Initial resize right away
    resizeCanvasSafe();

    return () => {
      window.removeEventListener("resize", handleWindowResize);
      window.Telegram?.WebApp?.offEvent?.("viewportChanged", handleWindowResize);
      map.off("click", handleMapClick);
      map.off("mousemove", handleMouseMove);
      map.off("render", triggerInstantRedraw);
      map.off("move", triggerInstantRedraw);
      map.off("zoom", triggerInstantRedraw);
      map.off("rotate", triggerInstantRedraw);
      map.off("pitch", triggerInstantRedraw);
      if (canvas && canvasContainer && canvas.parentElement === canvasContainer) {
        canvasContainer.removeChild(canvas);
      }
      map.remove();
      mapRef.current = null;
      delete (window as any).__eyeRadarMap;
    };
  }, []);

  // 2. Switch base map style only when toggling between Satellite and Tactical vector
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const isSat = visionMode !== "tactical";
    const targetStyle = isSat
      ? performanceTier === "LOW"
        ? SATELLITE_STYLE_LOW
        : SATELLITE_STYLE
      : mapStyleUrl;
    if (currentStyleRef.current !== targetStyle) {
      currentStyleRef.current = targetStyle;
      map.setStyle(targetStyle);
      map.once("styledata", () => {
        syncUkraineBorders(map, showFrontlineRef.current !== false);
        syncUkraineAlerts(map, activeAlertsRef.current, showAlertsRef.current !== false);
        if (performanceTierRef.current !== "LOW") {
          syncWeatherLayer(map, showWeatherRef.current !== false);
        }
      });
    }
  }, [mapStyleUrl, performanceTier, visionMode]);

  // 3. Live Weather Radar synchronization with RainViewer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (performanceTier === "LOW") {
      syncWeatherLayer(map, false);
      return;
    }
    if (map.isStyleLoaded()) {
      syncWeatherLayer(map, showWeather !== false);
    } else {
      map.once("styledata", () => syncWeatherLayer(map, showWeather !== false));
    }
  }, [performanceTier, showWeather, visionMode]);

  // 4. Tactical Frontline layer visibility synchronization
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visibility = showFrontline !== false ? "visible" : "none";
    const layerIds = ["frontline-glow", "frontline-dash", "frontline-core"];
    const applyVisibility = () => {
      for (const id of layerIds) {
        try {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, "visibility", visibility);
          }
        } catch {}
      }
    };
    if (map.isStyleLoaded()) {
      applyVisibility();
    } else {
      map.once("styledata", applyVisibility);
    }
  }, [showFrontline, visionMode]);

  // 5. Initial viewport is preserved at Ukraine + 120km operational border buffer
  useEffect(() => {
    centeredRef.current = true;
  }, []);

  // 5.5 Trigger immediate redraw of canvas overlay when packets, filters, impacts, or selection changes
  useEffect(() => {
    if (renderRef.current) {
      renderRef.current();
    }
  }, [packets, filters, impacts, showFirms, showAviation, showAlerts, showUncertainty, selectedImpact, selectedTarget]);

  // 6. Synchronized Canvas overlay render loop (locked 1:1 with MapLibre camera, event-driven with idle sleep)
  useEffect(() => {
    let animId: number | null = null;
    let idleHeartbeatTimer: any = null;
    let lastAudioCheck = 0;
    let cachedCtx: CanvasRenderingContext2D | null = null;
    let isLoopRunning = false;
    let settleFramesLeft = 0;

    const requestRender = () => {
      settleFramesLeft = 2; // Ensure smooth 2-frame settle on updates
      if (!isLoopRunning) {
        isLoopRunning = true;
        animId = requestAnimationFrame((t) => render(t));
      }
    };

    renderRef.current = requestRender;

    const render = (_time = performance.now()) => {
      animId = null;

      if (typeof document !== "undefined" && document.hidden) {
        isLoopRunning = false;
        return;
      }

      const map = mapRef.current;
      const canvas = canvasRef.current;
      const container = mapContainerRef.current;
      if (!cachedCtx || cachedCtx.canvas !== canvas) cachedCtx = canvas?.getContext("2d") ?? null;
      const ctx = cachedCtx;

      if (map && canvas && ctx && container) {
        const tierCfg = getTierConfig(performanceTierRef.current || "NORMAL");
        const ratio = Math.min(window.devicePixelRatio || 1, tierCfg.maxDpr);
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width <= 0 || height <= 0) {
          isLoopRunning = false;
          return;
        }

        const targetW = Math.round(width * ratio);
        const targetH = Math.round(height * ratio);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        const now = Date.now();
        // FPS throttling for ALL tiers — LOW 20fps, NORMAL 30fps, HIGH 60fps
        const delta = now - lastFrameTimeRef.current;
        if (delta < tierCfg.frameBudgetMs) {
          if (isLoopRunning) {
            animId = requestAnimationFrame((t) => render(t));
          }
          return;
        }
        lastFrameTimeRef.current = now;
        ctx.clearRect(0, 0, width, height);
        const zoom = map.getZoom();
        const currentLoc = locationRef.current;
        const currentPackets = packetsRef.current;
        const currentFilters = filtersRef.current;
        const currentSelected = selectedTargetRef.current;

        // B. Dynamic Planetary & Local Solar Illumination (Astronomical Real-Time Synchronization)
        if (showDayNightRef.current !== false) {
          const center = map.getCenter();
          const localSun = getLocalSolarStatus(center.lat, center.lng);
          const elev = localSun.elevationDeg;

          ctx.save();
          if (elev < 0) {
            // Sun is below horizon: astronomical night
            const nightFactor = Math.min(1, Math.max(0, -elev / 10));
            const baseAlpha = 0.36 * nightFactor;

            // Deep nocturnal atmosphere wash across the Earth (realistic satellite night view)
            const nightGrad = ctx.createLinearGradient(0, 0, 0, height);
            nightGrad.addColorStop(0, `rgba(4, 9, 24, ${Math.min(0.55, baseAlpha + 0.10)})`);
            nightGrad.addColorStop(0.5, `rgba(3, 8, 22, ${baseAlpha})`);
            nightGrad.addColorStop(1, `rgba(2, 6, 20, ${Math.min(0.55, baseAlpha + 0.08)})`);
            ctx.fillStyle = nightGrad;
            ctx.fillRect(0, 0, width, height);

            // Twilight golden/amber glow along the horizon if dusk/dawn (-12 < elev < 0)
            if (elev > -12) {
              const twilightFactor = 1 - (-elev / 12);
              const twiGrad = ctx.createLinearGradient(0, height * 0.65, 0, height);
              twiGrad.addColorStop(0, "rgba(217, 119, 6, 0)");
              twiGrad.addColorStop(1, `rgba(217, 119, 6, ${0.18 * twilightFactor})`);
              ctx.fillStyle = twiGrad;
              ctx.fillRect(0, height * 0.65, width, height * 0.35);
            }
          } else if (elev < 14) {
            // Golden hour warm tint
            const goldenFactor = (14 - elev) / 14;
            ctx.fillStyle = `rgba(245, 158, 11, ${goldenFactor * 0.08})`;
            ctx.fillRect(0, 0, width, height);
          }
          ctx.restore();

          // Physical MapLibre satellite tile brightness synchronization (throttled to 2.5s)
          if (now - lastBrightnessCheckRef.current > 2500) {
            lastBrightnessCheckRef.current = now;
            const satLayer = map.getLayer("satellite-tiles-layer") ? "satellite-tiles-layer" : map.getLayer("esri-satellite-layer") ? "esri-satellite-layer" : null;
            if (satLayer) {
              const nightFactor = Math.min(1, Math.max(0, -elev / 10));
              const targetBrightness = elev < 0 ? Math.max(0.35, 1.0 - nightFactor * 0.65) : 1.0;
              const targetSaturation = elev < 0 ? -0.45 * nightFactor : 0.0;
              const targetContrast = elev < 0 ? 0.25 * nightFactor : 0.0;

              if (Math.abs(targetBrightness - lastAppliedBrightnessRef.current) > 0.02) {
                lastAppliedBrightnessRef.current = targetBrightness;
                try {
                  map.setPaintProperty(satLayer, "raster-brightness-max", targetBrightness);
                  map.setPaintProperty(satLayer, "raster-saturation", targetSaturation);
                  map.setPaintProperty(satLayer, "raster-contrast", targetContrast);
                } catch {}
              }
            }
          }
        }

        // 1. Draw User Confirmed Home Location Beacon (Strictly anchored inside Ukraine from Neon)
        const isLocInUkraine = (l: { lat: number; lon: number }) =>
          l.lat >= 44.0 && l.lat <= 52.5 && l.lon >= 22.0 && l.lon <= 40.5;

        const activeHome = confirmedLocationRef.current && isLocInUkraine(confirmedLocationRef.current)
          ? { lat: confirmedLocationRef.current.lat, lon: confirmedLocationRef.current.lon }
          : currentLoc && isLocInUkraine(currentLoc)
          ? { lat: currentLoc.lat, lon: currentLoc.lon }
          : { lat: 50.4501, lon: 30.5234 }; // Canonical Kyiv default

        drawUserHomeBeacon(ctx, map, activeHome, undefined, now, width, height);

        // 1.1 Draw Selected Location Tactical Beacon if user inspected a temporary place on the map
        if (selectedLocationRef.current) {
          const selPt = map.project([selectedLocationRef.current.lon, selectedLocationRef.current.lat]);
          if (selPt.x >= -60 && selPt.x <= width + 60 && selPt.y >= -60 && selPt.y <= height + 60) {
            drawSelectedLocationBeacon(ctx, selPt.x, selPt.y, now);
          }
        }

        // Periodic tactical audio ping if danger enters 25km (checked every 3.5s)
        if (currentLoc && currentFilters?.sound !== false && now - lastAudioCheck > 3500) {
          lastAudioCheck = now;
          for (const p of currentPackets) {
            const [, type, lat, lon] = p;
            if (type === "uav" || type === "munition") {
              const d = haversineMeters({ lat, lon }, { lat: currentLoc.lat, lon: currentLoc.lon });
              if (d <= 25_000) {
                soundEngine.playRadarPing();
                break;
              }
            }
          }
        }

        // 2.0 Draw Background Alerts Layer (sirens) under all tactical tracks
        if (showAlertsRef.current !== false) {
          drawAlertsLayer(ctx, map, activeAlertsRef.current, now, width, height);
        }

        // 2.1 Draw Context Layer: NASA FIRMS / EO thermal hotspots
        if (showFirmsRef.current) {
          drawFirmsHotspots(ctx, map, trackStore.getFirmsEvents(), now, width, height, currentSelected?.[0]);
        }

        // 2.2 Draw Uncertainty Layer: Real sensor spatial uncertainty contacts (acoustic array engine detections)
        if (showUncertaintyRef.current !== false) {
          drawUncertaintyEvents(ctx, map, trackStore.getSensorUncertaintyEvents(), now, width, height, currentSelected?.[0]);
        }

        // 2.2 Draw Air Targets (Shahed, Missile, Recon, KAB, FPV, Jet, Helicopter) & Trajectory Vectors
        const placedPillBoxes: PillRect[] = [];
        const mapBearing = map.getBearing() || 0; // Hoisted: calculated once per animation frame
        const offsetSec = timelineOffsetRef.current;
        const isLowTier = performanceTierRef.current === "LOW";
        const cullingThreshold = isLowTier ? 30 : 80;

        let visiblePackets: TrackPacket[];
        try {
          const bounds = map.getBounds();
          const pad = 0.8; // ~80 km geo padding
          if (zoom < 7.0 || (bounds.getEast() - bounds.getWest()) > 15) {
            visiblePackets = currentPackets;
          } else {
            visiblePackets = trackStore.searchViewport(
              bounds.getWest() - pad,
              bounds.getSouth() - pad,
              bounds.getEast() + pad,
              bounds.getNorth() + pad
            );
            if (visiblePackets.length === 0 && currentPackets.length > 0) {
              visiblePackets = currentPackets;
            }
          }
        } catch {
          visiblePackets = currentPackets;
        }

        // 2.2 Draw Air Targets: Pass 1 — Collect visible targets with 60fps smooth kinematic interpolation
        interface RenderItem {
          id: string;
          type: string;
          targetX: number;
          targetY: number;
          scale: number;
          screenHeadingDeg: number;
          color: string;
          packetModel?: string;
          speedKmh: number;
          isSelected: boolean;
          shortName: string;
          altMsl: string;
          confidence?: number;
        }
        const renderItems: RenderItem[] = [];
        const civilItems: RenderItem[] = [];
        const tacticalItems: RenderItem[] = [];
        const perimeterItems: PerimeterItem[] = [];
        const isOverview = zoom <= 7.0;
        const cullingMargin = isOverview ? 120 : cullingThreshold;

        // Periodic pruning of interpolation cache for expired targets
        if (now - lastInterpPruneRef.current > 6000) {
          lastInterpPruneRef.current = now;
          for (const [tId, state] of Object.entries(targetInterpRef.current)) {
            if (now - state.lastTime > 12000) {
              delete targetInterpRef.current[tId];
            }
          }
        }

        for (const packet of visiblePackets) {
          const [id, type, lat, lon, heading, speed, timestamp, confidence, uncertaintyRadius, , altitude, packetModel] = packet;

          const isCivil = isCivilAviation(packet);
          if (isCivil && showAviationRef.current === false) {
            continue;
          }

          if (currentFilters) {
            if (type === "uav" && !currentFilters.uav) continue;
            if (type === "munition" && !currentFilters.munition) continue;
            if (type === "bomb" && currentFilters.bomb === false) continue;
            if (type === "fpv" && currentFilters.fpv === false) continue;
            if (isCivil && !currentFilters.aircraft && !isOverview) continue;
            if (type === "helicopter" && (currentFilters.helicopter !== undefined ? !currentFilters.helicopter : !currentFilters.aircraft) && !isOverview) continue;
          }

          // Operational Viewport Gating for Transponder / Border Flights:
          // Distant civil airliners (> 120 km from map center in Poland/Romania)
          // do NOT clutter the local operational view. They are visible only when the user enables the aviation layer
          // OR zooms out to regional overview (zoom <= 6.5).
          // Unconfirmed contacts / UNKNOWN objects / MILITARY / RECON / DRONES are NEVER suppressed by this filter.
          if (isCivil && !isOverview) {
            const mapCenter = map.getCenter();
            const distFromCenterKm = haversineMeters({ lat, lon }, { lat: mapCenter.lat, lon: mapCenter.lng }) / 1000;
            if (distFromCenterKm > 120 && !currentFilters?.aircraft) {
              continue;
            }
          }

          // Aerodynamic geographic propagation & smooth kinematic interpolation (60/120 FPS)
          let curLat = lat;
          let curLon = lon;
          let curHeading = heading;

          if (offsetSec > 0 && speed > 2) {
            const backH = (heading + 180) % 360;
            const hRad = (backH * Math.PI) / 180;
            const dist = speed * offsetSec;
            curLat = lat + (dist * Math.cos(hRad)) / 111139;
            curLon = lon + (dist * Math.sin(hRad)) / (111139 * Math.cos((lat * Math.PI) / 180));
            curHeading = heading;
          } else {
            // Live 60/120 FPS Aerodynamic Kinematic Propagation in Geographic Coordinates
            const prev = targetInterpRef.current[id];
            const latCos = Math.cos((lat * Math.PI) / 180) || 1;
            const packetAgeSec = Math.max(0, Math.min(6.0, (now - (timestamp || now)) / 1000));

            // Dead-reckoned true position calculated from latest packet timestamp
            const pHeadingRad = (heading * Math.PI) / 180;
            const pDistM = speed * packetAgeSec;
            const targetLatNow = lat + (pDistM * Math.cos(pHeadingRad)) / 111139;
            const targetLonNow = lon + (pDistM * Math.sin(pHeadingRad)) / (111139 * latCos);

            if (!prev || (now - prev.lastTime > 4000) || Math.hypot(targetLatNow - prev.lat, (targetLonNow - prev.lon) * latCos) > 0.4) {
              // Initial contact or major teleport (> 45 km): seed directly
              curLat = targetLatNow;
              curLon = targetLonNow;
              curHeading = heading;
            } else {
              const dtSec = Math.min(0.08, Math.max(0.001, (now - prev.lastTime) / 1000));

              // 1. Continuous aerodynamic forward glide along current smoothed heading
              const moveHeadingRad = (prev.heading * Math.PI) / 180;
              const moveDistM = speed * dtSec;
              const forwardLat = prev.lat + (moveDistM * Math.cos(moveHeadingRad)) / 111139;
              const forwardLon = prev.lon + (moveDistM * Math.sin(moveHeadingRad)) / (111139 * latCos);

              // 2. Softly absorb position discrepancy relative to current measurement
              const dLatErr = targetLatNow - forwardLat;
              const dLonErr = targetLonNow - forwardLon;
              const posAlpha = 1 - Math.exp(-3.5 * dtSec); // Smoothly converges in ~300-400ms without jitter
              curLat = forwardLat + dLatErr * posAlpha;
              curLon = forwardLon + dLonErr * posAlpha;

              // 3. Smooth aerodynamic heading turn (shortest angular arc)
              const dH = (heading - prev.heading + 540) % 360 - 180;
              const turnAlpha = 1 - Math.exp(-7.0 * dtSec);
              curHeading = (prev.heading + dH * turnAlpha + 360) % 360;
            }

            targetInterpRef.current[id] = {
              lat: curLat,
              lon: curLon,
              heading: curHeading,
              speed,
              lastTime: now
            };
          }

          const groundPoint = map.project([curLon, curLat]);

          const isOffScreen =
            groundPoint.x < -cullingMargin ||
            groundPoint.x > width + cullingMargin ||
            groundPoint.y < -cullingMargin ||
            groundPoint.y > height + cullingMargin;

          if (isOffScreen) {
            if (isCivil) continue;
            const mapCenter = map.getCenter();
            const distKm = Math.round(haversineMeters({ lat: curLat, lon: curLon }, { lat: mapCenter.lat, lon: mapCenter.lng }) / 1000);
            if (isNaN(distKm) || distKm > 250) {
              continue;
            }

            const cx = width / 2;
            const cy = height / 2;
            const dx = groundPoint.x - cx;
            const dy = groundPoint.y - cy;
            const angleRad = Math.atan2(dy, dx);
            const margin = 24;
            const halfW = (width - 2 * margin) / 2;
            const halfH = (height - 2 * margin) / 2;
            const absCos = Math.abs(Math.cos(angleRad)) || 1e-6;
            const absSin = Math.abs(Math.sin(angleRad)) || 1e-6;
            const t = Math.min(halfW / absCos, halfH / absSin);
            const edgeX = cx + t * Math.cos(angleRad);
            const edgeY = cy + t * Math.sin(angleRad);

            const color = TARGET_COLORS[type] ?? "#7dd3fc";
            const speedKmh = Math.round(speed * 3.6);

            perimeterItems.push({
              id,
              type,
              edgeX,
              edgeY,
              angleRad,
              color,
              distKm,
              shortName: type.toUpperCase(),
              speedKmh
            });
            continue;
          }

          const scale = Math.max(16, Math.min(28, 12 + zoom * 1.2));
          const renderX = groundPoint.x;
          const renderY = groundPoint.y;
          const renderHeading = (curHeading - mapBearing + 360) % 360;

          const isSelected = Boolean(currentSelected && currentSelected[0] === id);
          const color = isCivil ? "#94a3b8" : (TARGET_COLORS[type] ?? "#7dd3fc");

          const effectiveAltM =
            altitude !== undefined && altitude !== null
              ? altitude
              : type === "aircraft"
              ? 9800
              : type === "helicopter"
              ? 750
              : type === "munition"
              ? 450
              : type === "bomb"
              ? 2200
              : type === "fpv"
              ? 65
              : 180;
          const speedKmh = Math.round(speed * 3.6);
          const altMsl = effectiveAltM >= 1000 ? `${(effectiveAltM / 1000).toFixed(1)} км` : `${Math.round(effectiveAltM)} м`;

          const cleanModel = packetModel
            ? packetModel
                .replace(/ Cruise Missile/gi, "")
                .replace(/ Fighting Falcon/gi, "")
                .replace(/ Flanker/gi, "")
                .replace(/ Fulcrum/gi, "")
                .replace(/ Gunship/gi, "")
                .replace(/ Fighter/gi, "")
                .replace(/ Helicopter/gi, "")
                .replace(/ Scout UAV/gi, "")
                .replace(/ Recon/gi, "")
                .replace(/ \(CAP\)/gi, "")
                .replace(/ \(CSAR\)/gi, "")
                .replace(/ \(Jet\)/gi, "")
                .replace(/ \(Maritime\)/gi, "")
                .replace(/ \(УМПК\)/gi, "")
                .replace(/ \(Ударний\)/gi, "")
                .trim()
            : "";

          const isUnverified = type === "unknown";
          const shortName = isUnverified
            ? "UNKNOWN"
            : cleanModel || (
              type === "uav"
              ? "БПЛА"
              : type === "bomb"
              ? "КАБ"
              : type === "fpv"
              ? "FPV"
              : type === "munition"
              ? "Ракета"
              : type === "helicopter"
              ? "Гелікоптер"
              : type === "aircraft"
              ? (id.startsWith("adsb-") ? id.slice(5).toUpperCase() : (isCivil ? "Борт" : "Літак"))
              : "UNKNOWN"
            );

          const rItem: RenderItem = {
            id,
            type,
            targetX: renderX,
            targetY: renderY,
            scale,
            screenHeadingDeg: renderHeading,
            color,
            packetModel,
            speedKmh,
            isSelected,
            shortName,
            altMsl,
            confidence
          };

          renderItems.push(rItem);
          if (isCivil) {
            civilItems.push(rItem);
          } else {
            tacticalItems.push(rItem);
          }
        }

        trackStore.recordRenderFrame(
          renderItems.length,
          perimeterItems.length,
          Math.max(0, currentPackets.length - (renderItems.length + perimeterItems.length)),
          perimeterItems.length > 0 ? "offscreen_viewport" : "none"
        );

        // Pass 2: Subtle fading historical motion trail (only selected target or when offsetSec > 0 and zoom >= 9.0)
        const showHistory = offsetSec > 0;
        if (!isLowTier) {
          for (const item of renderItems) {
            if (item.isSelected || (showHistory && zoom >= 9.0)) {
              const trailPts = trackStore.getTrailPoints(item.id);
              if (trailPts.length >= 2) {
                const recentPts = trailPts.slice(-8);
                ctx.save();
                ctx.lineWidth = item.isSelected ? 1.8 : 1.2;
                for (let i = 1; i < recentPts.length; i++) {
                  const p0 = map.project([recentPts[i - 1][1], recentPts[i - 1][0]]);
                  const p1 = map.project([recentPts[i][1], recentPts[i][0]]);
                  const segAlpha = (i / recentPts.length) * (item.isSelected ? 0.6 : 0.28);
                  ctx.strokeStyle = item.color;
                  ctx.globalAlpha = segAlpha;
                  ctx.beginPath();
                  ctx.moveTo(p0.x, p0.y);
                  ctx.lineTo(p1.x, p1.y);
                  ctx.stroke();
                }
                ctx.restore();
              }
            }
          }
        }

        // Pass 2.5: Background Civil Aviation (Layer 2)
        // Muted #94a3b8, opacity 0.28-0.35, clustered into compact badges at overview zoom < 7.5
        if (showAviationRef.current !== false && civilItems.length > 0) {
          if (zoom < 7.5) {
            const gridSize = 50;
            const civilGrid: Record<string, RenderItem[]> = {};
            const civilStandalone: RenderItem[] = [];

            for (const cItem of civilItems) {
              if (cItem.isSelected) {
                civilStandalone.push(cItem);
                continue;
              }
              const gx = Math.floor(cItem.targetX / gridSize);
              const gy = Math.floor(cItem.targetY / gridSize);
              const key = `${gx}:${gy}`;
              if (!civilGrid[key]) civilGrid[key] = [];
              civilGrid[key].push(cItem);
            }

            for (const cell of Object.values(civilGrid)) {
              if (cell.length === 1) {
                civilStandalone.push(cell[0]);
              } else {
                let avgX = 0;
                let avgY = 0;
                for (const it of cell) {
                  avgX += it.targetX;
                  avgY += it.targetY;
                }
                avgX /= cell.length;
                avgY /= cell.length;
                drawCivilAviationCluster(ctx, avgX, avgY, cell.length);
              }
            }

            for (const cItem of civilStandalone) {
              if (cItem.isSelected) {
                ctx.save();
                ctx.translate(cItem.targetX, cItem.targetY);
                ctx.rotate((cItem.screenHeadingDeg * Math.PI) / 180);
                renderTacticalGlyph(ctx, {
                  size: cItem.scale,
                  rotationDeg: 0,
                  type: "aircraft",
                  color: "#94a3b8",
                  isSelected: true,
                  model: cItem.packetModel,
                  speedKmh: cItem.speedKmh,
                  isLowTier,
                  confidence: cItem.confidence,
                  timeMs: now
                });
                ctx.restore();
                drawMilitaryCalloutPill(
                  ctx,
                  cItem.targetX,
                  cItem.targetY,
                  cItem.shortName,
                  cItem.speedKmh,
                  cItem.altMsl,
                  "#94a3b8",
                  false,
                  false,
                  placedPillBoxes
                );
              } else {
                drawCivilAviationMuted(ctx, cItem.targetX, cItem.targetY, cItem.screenHeadingDeg);
              }
            }
          } else {
            // High zoom (>= 7.5): muted 12px civil silhouettes
            for (const cItem of civilItems) {
              ctx.save();
              ctx.globalAlpha = cItem.isSelected ? 1.0 : 0.32;
              ctx.translate(cItem.targetX, cItem.targetY);
              ctx.rotate((cItem.screenHeadingDeg * Math.PI) / 180);
              renderTacticalGlyph(ctx, {
                size: Math.max(12, cItem.scale * 0.75),
                rotationDeg: 0,
                type: "aircraft",
                color: "#94a3b8",
                isSelected: cItem.isSelected,
                model: cItem.packetModel,
                speedKmh: cItem.speedKmh,
                isLowTier,
                confidence: cItem.confidence,
                timeMs: now
              });
              ctx.restore();

              if (cItem.isSelected) {
                drawMilitaryCalloutPill(
                  ctx,
                  cItem.targetX,
                  cItem.targetY,
                  cItem.shortName,
                  cItem.speedKmh,
                  cItem.altMsl,
                  "#94a3b8",
                  false,
                  false,
                  placedPillBoxes
                );
              }
            }
          }
        }

        // Pass 3: Primary Tactical LiveTracks (Layer 1: uav, munition, bomb, fpv, military, unknown)
        const lodThreshold = isLowTier ? 120 : 250;
        const shouldCluster = zoom < 4.5 && tacticalItems.length > lodThreshold;

        if (shouldCluster) {
          const gridSize = 45; // 45px spatial clustering cell
          const grid: Record<string, RenderItem[]> = {};
          const standalone: RenderItem[] = [];

          for (const item of tacticalItems) {
            if (item.isSelected) {
              standalone.push(item);
              continue;
            }
            const gx = Math.floor(item.targetX / gridSize);
            const gy = Math.floor(item.targetY / gridSize);
            const key = `${gx}:${gy}`;
            if (!grid[key]) grid[key] = [];
            grid[key].push(item);
          }

          for (const cell of Object.values(grid)) {
            if (cell.length === 1) {
              standalone.push(cell[0]);
            } else {
              let avgX = 0;
              let avgY = 0;
              for (const it of cell) {
                avgX += it.targetX;
                avgY += it.targetY;
              }
              avgX /= cell.length;
              avgY /= cell.length;
              const primaryColor = cell[0].color;
              drawTacticalClusterNode(ctx, avgX, avgY, cell.length, primaryColor);
            }
          }

          for (const item of standalone) {
            ctx.save();
            ctx.translate(item.targetX, item.targetY);
            ctx.rotate((item.screenHeadingDeg * Math.PI) / 180);
            renderTacticalGlyph(ctx, {
              size: item.scale,
              rotationDeg: 0,
              type: item.type,
              color: item.color,
              isSelected: item.isSelected,
              model: item.packetModel,
              speedKmh: item.speedKmh,
              isLowTier: isLowTier,
              confidence: item.confidence,
              timeMs: now
            });
            ctx.restore();

            const showPill = item.isSelected;
            if (showPill) {
              drawMilitaryCalloutPill(
                ctx,
                item.targetX,
                item.targetY,
                item.shortName,
                item.speedKmh,
                item.altMsl,
                item.color,
                item.isSelected,
                true,
                placedPillBoxes
              );
            }
          }
        } else {
          for (const item of tacticalItems) {
            ctx.save();
            ctx.translate(item.targetX, item.targetY);
            ctx.rotate((item.screenHeadingDeg * Math.PI) / 180);
            renderTacticalGlyph(ctx, {
              size: item.scale,
              rotationDeg: 0,
              type: item.type,
              color: item.color,
              isSelected: item.isSelected,
              model: item.packetModel,
              speedKmh: item.speedKmh,
              isLowTier: isLowTier,
              confidence: item.confidence,
              timeMs: now
            });
            ctx.restore();

            const showPill = item.isSelected;
            if (showPill) {
              drawMilitaryCalloutPill(
                ctx,
                item.targetX,
                item.targetY,
                item.shortName,
                item.speedKmh,
                item.altMsl,
                item.color,
                item.isSelected,
                true,
                placedPillBoxes
              );
            }
          }
        }

        // Pass 4: Draw tactical perimeter indicators for off-screen targets
        if (perimeterItems.length > 0) {
          const sortedPerimeter = perimeterItems
            .sort((a, b) => a.distKm - b.distKm)
            .slice(0, 12);
          for (const pItem of sortedPerimeter) {
            drawTacticalPerimeterIndicator(
              ctx,
              pItem.edgeX,
              pItem.edgeY,
              pItem.angleRad,
              pItem.color,
              pItem.distKm,
              pItem.shortName
            );
          }
        }

        // 2.4 Draw Recent Impacts (60 min TTL) & Interceptions (10 min TTL) with clean clustering & collision-free labels
        if (impactsRef.current && impactsRef.current.length > 0) {
          interface ActiveImpactItem {
            evt: ImpactEvent;
            pt: { x: number; y: number };
            isImpact: boolean;
            label: string;
            fade: number;
            isSel: boolean;
          }
          const activeImpacts: ActiveImpactItem[] = [];

          for (const evt of impactsRef.current) {
            const elapsedMs = Math.max(0, now - evt.timestamp);
            const isImpact = evt.type === "impact";
            const ttlMs = isImpact ? 60 * 60 * 1000 : 10 * 60 * 1000;
            if (elapsedMs > ttlMs) continue;

            const pt = map.project([evt.lon, evt.lat]);
            if (pt.x < -80 || pt.x > width + 80 || pt.y < -80 || pt.y > height + 80) continue;

            const fade = Math.max(0.2, 1 - elapsedMs / ttlMs);
            const minAgo = Math.max(1, Math.round(elapsedMs / 60000));
            const timeText = elapsedMs < 60000 ? "< 1 хв тому" : minAgo < 60 ? `${minAgo} хв тому` : `${Math.floor(minAgo / 60)} год тому`;
            const label = isImpact ? `ПРИЛІТ (${timeText})` : `ЗБИТТЯ (${timeText})`;
            const isSel = Boolean(selectedImpactRef.current && selectedImpactRef.current.id === evt.id);

            activeImpacts.push({ evt, pt, isImpact, label, fade, isSel });
          }

          if (activeImpacts.length > 0) {
            const isOverview = zoom < 7.0;

            if (isOverview) {
              // Spatial clustering at overview zoom (< 7.0) to eliminate text collisions & clutter
              const cellSize = 42;
              const grid: Record<string, ActiveImpactItem[]> = {};
              const standalone: ActiveImpactItem[] = [];

              for (const it of activeImpacts) {
                if (it.isSel) {
                  standalone.push(it);
                  continue;
                }
                const gx = Math.floor(it.pt.x / cellSize);
                const gy = Math.floor(it.pt.y / cellSize);
                const k = `${gx}:${gy}`;
                if (!grid[k]) grid[k] = [];
                grid[k].push(it);
              }

              for (const cell of Object.values(grid)) {
                if (cell.length === 1) {
                  standalone.push(cell[0]);
                } else {
                  let avgX = 0;
                  let avgY = 0;
                  let hasImpact = false;
                  for (const it of cell) {
                    avgX += it.pt.x;
                    avgY += it.pt.y;
                    if (it.isImpact) hasImpact = true;
                  }
                  avgX /= cell.length;
                  avgY /= cell.length;

                  // Crisp tactical cluster node for multi-event locations
                  const clusterColor = hasImpact ? "#ef4444" : "#38bdf8";
                  drawTacticalClusterNode(ctx, avgX, avgY, cell.length, clusterColor);
                }
              }

              for (const it of standalone) {
                // At overview: compact icon, label strictly when selected!
                drawTacticalImpactMarker(ctx, it.pt.x, it.pt.y, it.isImpact, it.label, now, it.fade, it.isSel, it.isSel);
              }
            } else {
              // Detailed tactical zoom (>= 7.0): draw all pins, render labels with spatial collision avoidance
              const placedImpactLabels: PillRect[] = [];
              for (const it of activeImpacts) {
                let showLabel = it.isSel;
                if (!showLabel) {
                  const labelW = 95;
                  const labelH = 18;
                  const rect: PillRect = {
                    x: it.pt.x - labelW / 2,
                    y: it.pt.y + 14,
                    w: labelW,
                    h: labelH
                  };
                  const overlaps = placedImpactLabels.some((p) => doesPillOverlap(p, rect));
                  if (!overlaps) {
                    placedImpactLabels.push(rect);
                    showLabel = true;
                  }
                }
                drawTacticalImpactMarker(ctx, it.pt.x, it.pt.y, it.isImpact, it.label, now, it.fade, showLabel, it.isSel);
              }
            }
          }
        }

        // 2.5 Active layer status is handled by HTML operational-sector-badge in App.tsx

        // 3. Draw Active Reconnaissance Satellites (Persona-3, Bars-M, Lotos-S1, Kondor-FKA) - throttled to 1s
        // Skip satellite recon layer in LOW performance tier
        if (performanceTierRef.current !== "LOW" && showSatellitesRef.current !== false) {
          if (now - lastSatCalcRef.current > 1000 || cachedSatellitesRef.current.length === 0) {
            lastSatCalcRef.current = now;
            cachedSatellitesRef.current = calculateSatellitePositions(now);
          }
          drawSatelliteReconLayer(ctx, map, cachedSatellitesRef.current, now, width, height);
        }

        // 4. Adaptive render scheduler:
        // If map is moving/zooming/rotating/pitching, or if there are moving targets (speed > 2), or active sensor pulse, or settle frames left:
        // continue the rAF loop at adaptive tier rate.
        // Otherwise (stationary map and stationary/no targets), pause the rAF loop completely! (0% CPU/GPU idle load)
        const isMapMoving = map.isMoving() || map.isZooming() || map.isRotating();
        const hasMovingVisibleTargets = renderItems.length > 0 && renderItems.some(i => i.speedKmh > 7);
        const hasActiveSensorEvents = trackStore.getSensorUncertaintyCount() > 0;

        if (isMapMoving || hasMovingVisibleTargets || hasActiveSensorEvents || settleFramesLeft > 0) {
          if (settleFramesLeft > 0) settleFramesLeft--;
          isLoopRunning = true;
          animId = requestAnimationFrame((t) => render(t));
        } else {
          isLoopRunning = false;
        }
      } else {
        isLoopRunning = false;
      }
    };

    // Kick off initial frame
    requestRender();

    // 5 Hz idle heartbeat: smoothly updates solar elevation & clock without waking heavy GPU loop
    idleHeartbeatTimer = setInterval(() => {
      if (!isLoopRunning) {
        requestRender();
      }
    }, 5000);

    // Background pause: stop RAF loop when tab/app is hidden; restart on visible
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (animId !== null) {
          cancelAnimationFrame(animId);
          animId = null;
        }
        isLoopRunning = false;
      } else {
        // Resume: force a fresh redraw immediately
        requestRender();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
      if (idleHeartbeatTimer) clearInterval(idleHeartbeatTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      isLoopRunning = false;
      renderRef.current = null;
    };
  }, []);

  return (
    <div
      className={`map-shell map-view-container vision-${visionMode} ${
        isPickingLocation ? "is-picking-location" : ""
      }`}
    >
      <div ref={mapContainerRef} className="map-root" />
      <canvas ref={canvasRef} className="map-overlay" />
      <div className="space-vignette" />
      {isPickingLocation && (
        <div className="picking-prompt-pill">
          Клікніть на карті для встановлення точки спостереження
        </div>
      )}
      {followingTargetId && (
        <div className="following-prompt-pill">
          <span>СУПРОВОДЖЕННЯ: <strong>{followingTargetId.startsWith("adsb-") ? followingTargetId.slice(5).toUpperCase() : followingTargetId.toUpperCase()}</strong></span>
          {onStopFollow && (
            <button type="button" className="following-cancel-btn" onClick={onStopFollow}>
              ✕ ЗНЯТИ ЗАХОПЛЕННЯ
            </button>
          )}
        </div>
      )}
    </div>
  );
};
