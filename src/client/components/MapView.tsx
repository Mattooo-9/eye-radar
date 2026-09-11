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
import { drawNightCityLights } from "../lib/nightCityLights";
import type { FilterState } from "./StatusPanel";
import FpsCounter from "./FpsCounter";
import { SpatialIndex } from "../lib/spatialIndex.js";

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
        "raster-fade-duration": 0
      }
    },
    {
      id: "road-tiles-layer",
      type: "raster" as const,
      source: "road-tiles",
      paint: {
        "raster-opacity": 0.82,
        "raster-fade-duration": 0
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
  name: string | undefined,
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

  const label = name ? name : "Моя локація";
  drawTextWithOutline(
    ctx,
    label,
    pt.x + 9,
    pt.y + 4,
    "#38bdf8",
    "rgba(2, 6, 23, 0.95)",
    "bold 10px Inter, system-ui, sans-serif"
  );
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

const syncUkraineBorders = (map: maplibregl.Map, showFrontline = true) => {
  if (!map || !map.isStyleLoaded()) return;
  try {
    // Completely remove any custom border lines drawn over real borders
    const customBorderLayers = [
      "world-borders-glow",
      "world-borders-line",
      "ukraine-real-glow",
      "ukraine-real-border",
      "ukraine-oblasts-glow",
      "ukraine-oblasts-line"
    ];
    for (const id of customBorderLayers) {
      if (map.getLayer(id)) {
        try { map.removeLayer(id); } catch {}
      }
    }
    for (const src of ["world-borders", "ukraine-oblasts"]) {
      if (map.getSource(src)) {
        try { map.removeSource(src); } catch {}
      }
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
  _now: number,
  opacity = 1.0
) => {
  ctx.save();
  ctx.globalAlpha = Math.max(0.15, Math.min(1.0, opacity));
  const radius = isImpact ? 11 : 10;

  // 1. Core tactical badge
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = isImpact ? "rgba(220, 38, 38, 0.95)" : "rgba(14, 116, 144, 0.95)";
  ctx.fill();
  ctx.strokeStyle = isImpact ? "#fca5a5" : "#bae6fd";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 2. Central text symbol (no emojis)
  ctx.font = "bold 8px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(isImpact ? "!" : "ППО", x, y);

  // 3. Tactical label without emoji
  const cleanLabel = label.replace(/[💥🛡️]/gu, "").trim();
  ctx.font = "bold 9px Inter, -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#020617";
  ctx.lineWidth = 3;
  ctx.strokeText(cleanLabel, x, y + radius + 4);
  ctx.fillText(cleanLabel, x, y + radius + 4);

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

    // Sleek minimal satellite diamond marker (no circles, no boxes)
    ctx.save();
    ctx.translate(satPt.x, satPt.y);
    ctx.fillStyle = sat.type === "sar_radar" ? "#c084fc" : "#38bdf8";
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, 4);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Clean telemetry text without emojis
    const typeLabel = sat.type === "sar_radar" ? "SAR" : sat.type === "elint" ? "ELINT" : "HD";
    drawTextWithOutline(
      ctx,
      `${sat.name} [${typeLabel}] ${sat.altitudeKm} км`,
      satPt.x + 8,
      satPt.y - 4,
      sat.inRangeOfUkraine ? "#f43f5e" : "#38bdf8",
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
  helicopter: "#10b981"
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
  performanceTier = "NORMAL"
}: MapViewProps) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const centeredRef = useRef(false);

  // Stable references to eliminate component re-render teardowns
  const packetsRef = useRef(packets);
  packetsRef.current = packets;

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
  }, [packets]);

  const timelineOffsetRef = useRef(timelineOffsetSec);
  timelineOffsetRef.current = timelineOffsetSec;

  const performanceTierRef = useRef(performanceTier);
  performanceTierRef.current = performanceTier;

  const lastFrameTimeRef = useRef(0);

  const impactsRef = useRef(impacts);
  impactsRef.current = impacts;

  const onSelectImpactRef = useRef(onSelectImpact);
  onSelectImpactRef.current = onSelectImpact;

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

  // Safe canvas resizer: ONLY updates dimensions if they have changed, never clears buffer on subpixel drift
  const resizeCanvasSafe = () => {
    const canvas = canvasRef.current;
    const container = mapContainerRef.current;
    if (!canvas || !container) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
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

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: initialStyle,
      center: [31.5, 49.0], // Center of Ukraine
      zoom: 6.2,
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
      attributionControl: false
    });

    mapRef.current = map;
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
      let minTargetDist = 28;
      for (const p of packetsRef.current) {
        const [, , lat, lon] = p;
        const pt = map.project([lon, lat]);
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
      const scaleControl = new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" });
      map.addControl(scaleControl, "bottom-right");
      triggerInstantRedraw();
    });
    map.on("styledata", () => {
      applyImmediateSolarLighting(map);
      syncUkraineBorders(map, showFrontlineRef.current !== false);
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

  // 5. Smooth flyTo user location on first GPS acquisition
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !location || centeredRef.current) return;

    map.flyTo({
      center: [location.lon, location.lat],
      zoom: 7.2,
      pitch: 0,
      duration: 1500
    });
    centeredRef.current = true;
  }, [location]);

  // 5.5 Trigger immediate redraw of canvas overlay when packets, filters, or impacts change
  useEffect(() => {
    if (renderRef.current) {
      renderRef.current();
    }
  }, [packets, filters, impacts]);

  // 6. Synchronized Canvas overlay render loop (locked 1:1 with MapLibre camera)
  useEffect(() => {
    let animId: number;
    let lastAudioCheck = 0;
    let cachedCtx: CanvasRenderingContext2D | null = null;

    const render = (_time = performance.now(), _force = false) => {
      animId = requestAnimationFrame((t) => render(t, false));

      renderRef.current = () => render(performance.now(), true);
      const map = mapRef.current;
      const canvas = canvasRef.current;
      const container = mapContainerRef.current;
      if (!cachedCtx || cachedCtx.canvas !== canvas) cachedCtx = canvas?.getContext("2d") ?? null;
      const ctx = cachedCtx;

      if (map && canvas && ctx && container) {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width <= 0 || height <= 0) return;

        const targetW = Math.round(width * ratio);
        const targetH = Math.round(height * ratio);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const now = Date.now();
        // FPS throttling for LOW performance tier (~30 fps)
        const delta = now - lastFrameTimeRef.current;
        if (performanceTierRef.current === "LOW" && delta < 33) {
          // Skip this frame but keep the animation loop alive
          requestAnimationFrame(render);
          return;
        }
        lastFrameTimeRef.current = now;
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

          // C. Living Night City Lights Illumination (Authentic soft NASA Black Marble glow)
          if (elev < 0) {
            const nightFactor = Math.min(1, Math.max(0, -elev / 10));
            drawNightCityLights(ctx, map, nightFactor, now, width, height);
          }

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

        // 1. Draw User Confirmed Home Location Beacon & Range Rings (Always visible on map)
        const activeHome = confirmedLocationRef.current
          ? { lat: confirmedLocationRef.current.lat, lon: confirmedLocationRef.current.lon }
          : currentLoc
          ? { lat: currentLoc.lat, lon: currentLoc.lon }
          : null;
        if (activeHome) {
          drawUserHomeBeacon(
            ctx,
            map,
            activeHome,
            confirmedLocationRef.current?.name,
            now,
            width,
            height
          );
        }

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



        // 2.2 Draw Air Targets (Shahed, Missile, Recon, KAB, FPV, Jet, Helicopter) & Trajectory Vectors
        const placedPillBoxes: PillRect[] = [];
        const mapBearing = map.getBearing() || 0; // Hoisted: calculated once per animation frame
        const offsetSec = timelineOffsetRef.current;
        const isLowTier = performanceTierRef.current === "LOW";
        const cullingThreshold = isLowTier ? 30 : 80;

        let visiblePackets: TrackPacket[];
        try {
          const bounds = map.getBounds();
          const pad = 0.5; // ~50 km geo padding
          visiblePackets = spatialIndexRef.current.search({
            minX: bounds.getWest() - pad,
            minY: bounds.getSouth() - pad,
            maxX: bounds.getEast() + pad,
            maxY: bounds.getNorth() + pad
          });
        } catch {
          visiblePackets = currentPackets;
        }

        // 2.2 Draw Air Targets: Pass 1 — Collect visible targets and trajectory vectors
        const trajectoryBatches: Record<string, Array<{ startX: number; startY: number; tipX: number; tipY: number }>> = {};
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
        }
        const renderItems: RenderItem[] = [];

        for (const packet of visiblePackets) {
          const [id, type, lat, lon, heading, speed, timestamp, confidence, uncertaintyRadius, , altitude, packetModel] = packet;

          if (currentFilters) {
            if (type === "uav" && !currentFilters.uav) continue;
            if (type === "munition" && !currentFilters.munition) continue;
            if (type === "bomb" && currentFilters.bomb === false) continue;
            if (type === "fpv" && currentFilters.fpv === false) continue;
            if (type === "aircraft" && !currentFilters.aircraft) continue;
            if (type === "helicopter" && (currentFilters.helicopter !== undefined ? !currentFilters.helicopter : !currentFilters.aircraft)) continue;
          }

          // Fast equirectangular dead-reckoning extrapolation
          const elapsedSec = Math.max(0, Math.min(3.0, (now - (timestamp || now)) / 1000));
          let curLat = lat;
          let curLon = lon;
          if (offsetSec > 0 && speed > 2) {
            const backH = (heading + 180) % 360;
            const hRad = (backH * Math.PI) / 180;
            const dist = speed * offsetSec;
            curLat = lat + (dist * Math.cos(hRad)) / 111139;
            curLon = lon + (dist * Math.sin(hRad)) / (111139 * Math.cos((lat * Math.PI) / 180));
          } else if (speed > 2 && elapsedSec > 0.03) {
            const hRad = (heading * Math.PI) / 180;
            const dist = speed * elapsedSec;
            curLat = lat + (dist * Math.cos(hRad)) / 111139;
            curLon = lon + (dist * Math.sin(hRad)) / (111139 * Math.cos((lat * Math.PI) / 180));
          }
          const groundPoint = map.project([curLon, curLat]);

          if (
            groundPoint.x < -cullingThreshold ||
            groundPoint.x > width + cullingThreshold ||
            groundPoint.y < -cullingThreshold ||
            groundPoint.y > height + cullingThreshold
          ) {
            continue;
          }

          const scale = Math.max(12, Math.min(22, 10 + zoom * 0.85));
          const targetX = groundPoint.x;
          const targetY = groundPoint.y;

          const screenHeadingDeg = (heading - mapBearing + 360) % 360;
          const headingRad = (screenHeadingDeg * Math.PI) / 180;
          const fwdX = Math.sin(headingRad);
          const fwdY = -Math.cos(headingRad);

          const isSelected = Boolean(currentSelected && currentSelected[0] === id);
          const color = TARGET_COLORS[type] ?? "#7dd3fc";

          if (speed > 5) {
            const noseDist = scale * 0.95;
            const vectorLen = Math.max(16, Math.min(38, 12 + zoom * 2.0));
            const startX = targetX + fwdX * noseDist;
            const startY = targetY + fwdY * noseDist;
            const tipX = targetX + fwdX * (noseDist + vectorLen);
            const tipY = targetY + fwdY * (noseDist + vectorLen);

            if (!trajectoryBatches[color]) trajectoryBatches[color] = [];
            trajectoryBatches[color].push({ startX, startY, tipX, tipY });
          }

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

          const shortName = cleanModel || (
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
            : id.startsWith("adsb-")
            ? id.slice(5).toUpperCase()
            : "Ціль"
          );

          renderItems.push({
            id,
            type,
            targetX,
            targetY,
            scale,
            screenHeadingDeg,
            color,
            packetModel,
            speedKmh,
            isSelected,
            shortName,
            altMsl
          });
        }

        // Pass 2: Stroke all batched trajectories at once
        ctx.save();
        ctx.lineWidth = 1.4;
        for (const [col, lines] of Object.entries(trajectoryBatches)) {
          ctx.strokeStyle = col;
          ctx.beginPath();
          for (let i = 0; i < lines.length; i++) {
            ctx.moveTo(lines[i].startX, lines[i].startY);
            ctx.lineTo(lines[i].tipX, lines[i].tipY);
          }
          ctx.stroke();
        }
        ctx.restore();

        // Pass 3: Draw silhouettes and callout pills on top
        for (const item of renderItems) {
          if (item.type === "uav") {
            drawUavSilhouette(ctx, item.targetX, item.targetY, item.scale, item.screenHeadingDeg, item.color, now, item.packetModel, item.speedKmh);
          } else if (item.type === "bomb") {
            drawKabSilhouette(ctx, item.targetX, item.targetY, item.scale, item.screenHeadingDeg, item.color, now);
          } else if (item.type === "fpv") {
            drawFpvSilhouette(ctx, item.targetX, item.targetY, item.scale, item.screenHeadingDeg, item.color, now);
          } else if (item.type === "munition") {
            drawMissileSilhouette(ctx, item.targetX, item.targetY, item.scale, item.screenHeadingDeg, item.color, now);
          } else if (item.type === "helicopter") {
            drawHelicopterSilhouette(ctx, item.targetX, item.targetY, item.scale, item.screenHeadingDeg, item.color, now);
          } else {
            drawAircraftSilhouette(ctx, item.targetX, item.targetY, item.scale, item.screenHeadingDeg, item.color, now);
          }

          if (item.isSelected) {
            drawMilitaryCalloutPill(
              ctx,
              item.targetX,
              item.targetY,
              item.shortName,
              item.speedKmh,
              item.altMsl,
              item.color,
              true,
              true,
              placedPillBoxes
            );
          }
        }

        // 2.4 Draw Recent Impacts (60 min TTL) & Interceptions (10 min TTL) with smooth fading
        if (impactsRef.current && impactsRef.current.length > 0) {
          for (const evt of impactsRef.current) {
            const elapsedMs = Math.max(0, now - evt.timestamp);
            const isImpact = evt.type === "impact";
            const ttlMs = isImpact ? 60 * 60 * 1000 : 10 * 60 * 1000;
            if (elapsedMs > ttlMs) continue;

            const pt = map.project([evt.lon, evt.lat]);
            if (pt.x < -80 || pt.x > width + 80 || pt.y < -80 || pt.y > height + 80) continue;

            const fade = Math.max(0.15, 1 - elapsedMs / ttlMs);
            const minAgo = Math.max(1, Math.round(elapsedMs / 60000));
            const timeText = elapsedMs < 60000 ? "< 1 хв тому" : minAgo < 60 ? `${minAgo} хв тому` : `${Math.floor(minAgo / 60)} год тому`;
            const label = isImpact ? `ПРИЛІТ (${timeText})` : `ЗБИТТЯ (${timeText})`;

            drawTacticalImpactMarker(ctx, pt.x, pt.y, isImpact, label, now, fade);
          }
        }

        // 3. Draw Active Reconnaissance Satellites (Persona-3, Bars-M, Lotos-S1, Kondor-FKA) - throttled to 1s
        // Skip satellite recon layer in LOW performance tier
        if (performanceTierRef.current !== "LOW" && showSatellitesRef.current !== false) {
          if (now - lastSatCalcRef.current > 1000 || cachedSatellitesRef.current.length === 0) {
            lastSatCalcRef.current = now;
            cachedSatellitesRef.current = calculateSatellitePositions(now);
          }
          drawSatelliteReconLayer(ctx, map, cachedSatellitesRef.current, now, width, height);
        }
      }
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
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
