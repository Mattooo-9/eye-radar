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

export type VisionMode = "satellite" | "nvg" | "flir" | "tactical";

interface MapViewProps {
  packets: TrackPacket[];
  mapStyleUrl: string;
  location: TrustedLocation | null;
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
    }
  ]
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

  // Drop events older than 5 minutes from the live map to prevent clutter
  if (elapsedMs > 5 * 60 * 1000) return;

  ctx.save();

  // 1. Brief subtle shockwave ring ONLY for brand new events (< 6 seconds old)
  if (elapsedMs < 6_000) {
    const pulsePhase = (now % 1200) / 1200;
    const ringRadius = 8 + pulsePhase * 14;
    const ringAlpha = Math.max(0, (1 - pulsePhase) * 0.65);

    ctx.beginPath();
    ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = isImpact ? `rgba(239, 68, 68, ${ringAlpha})` : `rgba(6, 182, 212, ${ringAlpha})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // 2. Compact military tactical badge (clean, unbloated, high-contrast)
  const minAgo = Math.max(1, Math.round(elapsedMs / 60000));
  const timeText = elapsedMs < 60000 ? "< 1 хв тому" : minAgo < 60 ? `${minAgo} хв тому` : `${Math.floor(minAgo / 60)} год тому`;
  const label = isImpact ? `💥 ПРИЛІТ (${timeText})` : `🛡️ ЗБИТТЯ (${timeText})`;

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
  model?: string
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);

  const isJet = model?.includes("238") || model?.includes("Jet");
  const isRecon = model?.includes("Recon") || model?.includes("Supercam") || model?.includes("Orlan");

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

const drawLockReticle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotationDeg: number
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotationDeg * Math.PI) / 180);

  const size = 28;
  const bracket = 9;
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2.2;

  // Brackets
  ctx.beginPath();
  ctx.moveTo(-size, -size + bracket);
  ctx.lineTo(-size, -size);
  ctx.lineTo(-size + bracket, -size);
  ctx.moveTo(size - bracket, -size);
  ctx.lineTo(size, -size);
  ctx.lineTo(size, -size + bracket);
  ctx.moveTo(size, size - bracket);
  ctx.lineTo(size, size);
  ctx.lineTo(size - bracket, size);
  ctx.moveTo(-size + bracket, size);
  ctx.lineTo(-size, size);
  ctx.lineTo(-size, size - bracket);
  ctx.stroke();

  // Crosshairs
  ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(6, 0);
  ctx.moveTo(0, -6);
  ctx.lineTo(0, 6);
  ctx.stroke();

  ctx.restore();
};

const drawMissileFlame = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  timeMs: number
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((heading + 180) * Math.PI) / 180);

  const flicker = (Math.sin(timeMs / 35) * 0.5 + 0.5) * 8;
  const flameLen = 18 + flicker;

  const grad = ctx.createLinearGradient(0, 0, 0, flameLen);
  grad.addColorStop(0, "rgba(255, 255, 255, 0.98)");
  grad.addColorStop(0.25, "rgba(251, 146, 60, 0.95)");
  grad.addColorStop(0.65, "rgba(239, 68, 68, 0.8)");
  grad.addColorStop(1, "rgba(239, 68, 68, 0)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-3.5, 0);
  ctx.lineTo(0, flameLen);
  ctx.lineTo(3.5, 0);
  ctx.closePath();
  ctx.fill();

  const diamondY = flameLen * 0.45;
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.beginPath();
  ctx.moveTo(0, diamondY - 2.5);
  ctx.lineTo(2, diamondY);
  ctx.lineTo(0, diamondY + 2.5);
  ctx.lineTo(-2, diamondY);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
};

const drawGroundReticle = (
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  isThreat: boolean,
  timeMs: number
) => {
  ctx.save();
  const bSize = 14;
  const bLen = 5;
  const pulse = Math.sin(timeMs / 180) * 0.2 + 0.8;
  const strokeCol = isThreat
    ? `rgba(239, 68, 68, ${pulse})`
    : `rgba(56, 189, 248, ${pulse})`;

  ctx.strokeStyle = strokeCol;
  ctx.lineWidth = 1.6;

  // 4 corner brackets pinned to ground
  ctx.beginPath();
  // Top-left
  ctx.moveTo(gx - bSize, gy - bSize + bLen);
  ctx.lineTo(gx - bSize, gy - bSize);
  ctx.lineTo(gx - bSize + bLen, gy - bSize);
  // Top-right
  ctx.moveTo(gx + bSize - bLen, gy - bSize);
  ctx.lineTo(gx + bSize, gy - bSize);
  ctx.lineTo(gx + bSize, gy - bSize + bLen);
  // Bottom-right
  ctx.moveTo(gx + bSize, gy + bSize - bLen);
  ctx.lineTo(gx + bSize, gy + bSize);
  ctx.lineTo(gx + bSize - bLen, gy + bSize);
  // Bottom-left
  ctx.moveTo(gx - bSize + bLen, gy + bSize);
  ctx.lineTo(gx - bSize, gy + bSize);
  ctx.lineTo(gx - bSize, gy + bSize - bLen);
  ctx.stroke();

  // Fine crosshair ticks
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(gx - 4, gy);
  ctx.lineTo(gx + 4, gy);
  ctx.moveTo(gx, gy - 4);
  ctx.lineTo(gx, gy + 4);
  ctx.stroke();

  // Central nadir pin
  ctx.fillStyle = isThreat ? "#ef4444" : "#38bdf8";
  ctx.beginPath();
  ctx.arc(gx, gy, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

const drawSelectedLocationReticle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  timeMs: number
) => {
  ctx.save();
  const pulse = Math.sin(timeMs / 220) * 0.25 + 0.75;
  const outerR = 20 + Math.sin(timeMs / 300) * 4;

  // 1. Concentric pulsing radar ring
  ctx.beginPath();
  ctx.arc(x, y, outerR, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(56, 189, 248, ${0.45 * pulse})`;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 4]);
  ctx.stroke();

  // 2. Tactical corner brackets
  const bSize = 16;
  const bLen = 6;
  ctx.setLineDash([]);
  ctx.strokeStyle = `rgba(56, 189, 248, ${0.9 * pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  // TL
  ctx.moveTo(x - bSize, y - bSize + bLen);
  ctx.lineTo(x - bSize, y - bSize);
  ctx.lineTo(x - bSize + bLen, y - bSize);
  // TR
  ctx.moveTo(x + bSize - bLen, y - bSize);
  ctx.lineTo(x + bSize, y - bSize);
  ctx.lineTo(x + bSize, y - bSize + bLen);
  // BR
  ctx.moveTo(x + bSize, y + bSize - bLen);
  ctx.lineTo(x + bSize, y + bSize);
  ctx.lineTo(x + bSize - bLen, y + bSize);
  // BL
  ctx.moveTo(x - bSize + bLen, y + bSize);
  ctx.lineTo(x - bSize, y + bSize);
  ctx.lineTo(x - bSize, y + bSize - bLen);
  ctx.stroke();

  // 3. Pinpoint crosshair
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.beginPath();
  ctx.moveTo(x - 5, y);
  ctx.lineTo(x + 5, y);
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y + 5);
  ctx.stroke();

  // 4. Center cyan dot
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#38bdf8";
  ctx.fill();

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
    ? `${modelName} • ${speedKmh} км/год • ${altStr}`
    : `${modelName} • ${speedKmh} км/год`;

  ctx.font = "bold 10px Inter, -apple-system, system-ui, sans-serif";
  const metrics = ctx.measureText(text);
  const pillW = Math.max(85, Math.ceil(metrics.width) + 18);
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
  ctx.roundRect(px, py, pillW, pillH, 9);
  ctx.fill();
  ctx.stroke();

  // Subtle lead connector line from target to pill (starting outside silhouette boundary)
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

  // Status indicator dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px + 7.5, py + 9, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Crisp high-contrast typography
  ctx.fillStyle = "#f8fafc";
  ctx.textBaseline = "middle";
  ctx.fillText(text, px + 14, py + 9.5);

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
    // All Country Borders — world-borders.geojson includes accurate Ukraine geometry
    // NO custom Ukraine overlay: only this real-data layer is used
    if (!map.getSource("world-borders")) {
      map.addSource("world-borders", {
        type: "geojson",
        data: "/world-borders.geojson"
      });
    }

    if (!map.getLayer("world-borders-glow")) {
      map.addLayer({
        id: "world-borders-glow",
        type: "line",
        source: "world-borders",
        paint: {
          "line-color": "#475569",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2.0, 6, 3.5, 10, 5.0],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 3, 1.0, 6, 2.0, 10, 3.0],
          "line-opacity": 0.45
        }
      });
    }

    if (!map.getLayer("world-borders-line")) {
      map.addLayer({
        id: "world-borders-line",
        type: "line",
        source: "world-borders",
        paint: {
          "line-color": "#94a3b8",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.0, 6, 1.6, 10, 2.2],
          "line-opacity": 0.85
        }
      });
    }

    // Ukraine state border: bright distinct highlight on top of world-borders-line
    // Uses world-borders source, filter by ISO_A3 = UKR for accurate geometry
    if (!map.getLayer("ukraine-real-glow")) {
      map.addLayer({
        id: "ukraine-real-glow",
        type: "line",
        source: "world-borders",
        filter: ["any",
          ["==", ["get", "ISO_A3"], "UKR"],
          ["==", ["get", "ADM0_A3"], "UKR"],
          ["==", ["get", "SOV_A3"], "UKR"]
        ],
        paint: {
          "line-color": "#0ea5e9",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3.5, 6, 6.0, 10, 9.0],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 3, 2.0, 6, 3.5, 10, 5.0],
          "line-opacity": 0.65
        }
      });
    }

    if (!map.getLayer("ukraine-real-border")) {
      map.addLayer({
        id: "ukraine-real-border",
        type: "line",
        source: "world-borders",
        filter: ["any",
          ["==", ["get", "ISO_A3"], "UKR"],
          ["==", ["get", "ADM0_A3"], "UKR"],
          ["==", ["get", "SOV_A3"], "UKR"]
        ],
        paint: {
          "line-color": "#38bdf8",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.5, 6, 2.2, 10, 3.0],
          "line-opacity": 0.95
        }
      });
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
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.6, 8, 3.8, 12, 4.8],
          "line-dasharray": [6, 4],
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
  now: number
) => {
  ctx.save();
  const pulse = Math.sin(now / 220) * 0.2 + 0.8;
  const radius = isImpact ? 14 : 13;

  // 1. Pulsing outer shockwave ring
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.5 * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = isImpact ? "rgba(239, 68, 68, 0.45)" : "rgba(14, 165, 233, 0.45)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 2. Core tactical badge
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = isImpact ? "rgba(220, 38, 38, 0.95)" : "rgba(14, 116, 144, 0.95)";
  ctx.fill();
  ctx.strokeStyle = isImpact ? "#fca5a5" : "#bae6fd";
  ctx.lineWidth = 2.0;
  ctx.stroke();

  // 3. Central emoji symbol
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(isImpact ? "💥" : "🛡️", x, y);

  // 4. Tactical label with contrast halo
  ctx.font = "bold 10px Inter, -apple-system, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#020617";
  ctx.lineWidth = 3;
  ctx.strokeText(label, x, y + radius + 4);
  ctx.fillText(label, x, y + radius + 4);

  ctx.restore();
};

const drawSatelliteReconLayer = (
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  satellites: SatelliteTrack[],
  now: number,
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

    // 1. Orbital ground track swath
    const swathRadiusPx = Math.min(100, (sat.swathWidthKm / 12) * Math.max(1, map.getZoom() * 0.7));
    const pulse = Math.sin(now / 240) * 0.2 + 0.8;

    ctx.save();
    ctx.beginPath();
    ctx.arc(satPt.x, satPt.y, swathRadiusPx, 0, Math.PI * 2);
    ctx.fillStyle = sat.type === "sar_radar"
      ? `rgba(168, 85, 247, ${0.08 * pulse})`
      : sat.type === "elint"
      ? `rgba(234, 179, 8, ${0.08 * pulse})`
      : `rgba(56, 189, 248, ${0.08 * pulse})`;
    ctx.fill();
    ctx.strokeStyle = sat.type === "sar_radar"
      ? `rgba(168, 85, 247, ${0.45 * pulse})`
      : sat.type === "elint"
      ? `rgba(234, 179, 8, ${0.45 * pulse})`
      : `rgba(56, 189, 248, ${0.45 * pulse})`;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.restore();

    // 2. Satellite craft icon
    ctx.save();
    ctx.translate(satPt.x, satPt.y);
    ctx.rotate((sat.heading * Math.PI) / 180);

    // Central satellite payload bus
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(-3.5, -5, 7, 10);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1;
    ctx.strokeRect(-3.5, -5, 7, 10);

    // Solar panels
    ctx.fillStyle = "#0284c7";
    ctx.fillRect(-15, -3, 11, 6);
    ctx.fillRect(4, -3, 11, 6);
    ctx.strokeStyle = "#93c5fd";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-15, -3, 11, 6);
    ctx.strokeRect(4, -3, 11, 6);

    // Sensor dish/lens indicator
    ctx.beginPath();
    ctx.arc(0, -6, 2, 0, Math.PI * 2);
    ctx.fillStyle = sat.type === "sar_radar" ? "#c084fc" : "#38bdf8";
    ctx.fill();
    ctx.restore();

    // 3. Telemetry badge
    const typeLabel = sat.type === "sar_radar" ? "РАДАР-SAR" : sat.type === "elint" ? "РТР-ELINT" : "ОПТИКА-HD";
    drawTextWithOutline(
      ctx,
      `🛰️ ${sat.name} [${typeLabel}] • ${sat.altitudeKm} км`,
      satPt.x + 16,
      satPt.y - 4,
      sat.inRangeOfUkraine ? "#f43f5e" : "#38bdf8",
      "rgba(0, 0, 0, 0.95)",
      "9px Inter, monospace"
    );

    if (sat.inRangeOfUkraine) {
      drawTextWithOutline(
        ctx,
        `⚠️ ЗОНА СКАНУВАННЯ УКРАЇНИ (${sat.swathWidthKm} км)`,
        satPt.x + 16,
        satPt.y + 9,
        "#fbbf24",
        "rgba(0, 0, 0, 0.95)",
        "8px Inter, monospace"
      );
    }
  }
  ctx.restore();
};

export const MapView = ({
  packets,
  mapStyleUrl,
  location,
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
  onSelectImpact
}: MapViewProps) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const centeredRef = useRef(false);

  // Stable references to eliminate component re-render teardowns
  const packetsRef = useRef(packets);
  packetsRef.current = packets;

  const impactsRef = useRef(impacts);
  impactsRef.current = impacts;

  const onSelectImpactRef = useRef(onSelectImpact);
  onSelectImpactRef.current = onSelectImpact;

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const locationRef = useRef(location);
  locationRef.current = location;

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

    map.on("load", () => {
      resizeCanvasSafe();
      syncWeatherLayer(map, showWeatherRef.current !== false);
      syncUkraineBorders(map, showFrontlineRef.current !== false);
      const scaleControl = new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" });
      map.addControl(scaleControl, "bottom-right");
      triggerInstantRedraw();
    });
    map.on("styledata", () => {
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
    const targetStyle = isSat ? SATELLITE_STYLE : mapStyleUrl;
    if (currentStyleRef.current !== targetStyle) {
      currentStyleRef.current = targetStyle;
      map.setStyle(targetStyle);
      map.once("styledata", () => {
        syncUkraineBorders(map, showFrontlineRef.current !== false);
        syncWeatherLayer(map, showWeatherRef.current !== false);
      });
    }
  }, [mapStyleUrl, visionMode]);

  // 3. Live Weather Radar synchronization with RainViewer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) {
      syncWeatherLayer(map, showWeather !== false);
    } else {
      map.once("styledata", () => syncWeatherLayer(map, showWeather !== false));
    }
  }, [showWeather, visionMode]);

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
      zoom: 8.5,
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

    const render = (_time = performance.now(), _force = false) => {
      animId = requestAnimationFrame((t) => render(t, false));

      renderRef.current = () => render(performance.now(), true);
      const map = mapRef.current;
      const canvas = canvasRef.current;
      const container = mapContainerRef.current;
      const ctx = canvas?.getContext("2d");

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
        const zoom = map.getZoom();
        const currentLoc = locationRef.current;
        const currentPackets = packetsRef.current;
        const currentFilters = filtersRef.current;
        const currentSelected = selectedTargetRef.current;

        // A. Orbital Space Starfield (deep space perspective when zoomed out)
        if (zoom <= 4.5) {
          ctx.save();
          for (let i = 0; i < 65; i++) {
            const sx = (i * 149.3 + 47) % width;
            const sy = (i * 211.7 + 83) % height;
            const twinkle = Math.sin(now / 350 + i) * 0.45 + 0.55;
            ctx.fillStyle = `rgba(226, 232, 240, ${twinkle * 0.55})`;
            ctx.fillRect(sx, sy, 1.5, 1.5);
          }
          ctx.restore();
        }

        // B. Dynamic Planetary & Local Solar Illumination (Astronomical Real-Time Synchronization)
        if (showDayNightRef.current !== false) {
          const center = map.getCenter();
          const localSun = getLocalSolarStatus(center.lat, center.lng);
          const elev = localSun.elevationDeg;

          ctx.save();
          if (elev < 0) {
            // Sun is below horizon: astronomical night / dusk transition
            // At elev = -15 deg, full astronomical night is reached (factor = 1.0)
            const nightFactor = Math.min(1, Math.max(0, -elev / 15));
            const baseAlpha = 0.52 + nightFactor * 0.28; // 0.52 at dusk -> 0.80 at deep night

            // Atmosphere midnight gradient
            const nightGrad = ctx.createLinearGradient(0, 0, 0, height);
            nightGrad.addColorStop(0, `rgba(2, 6, 23, ${Math.min(0.88, baseAlpha + 0.06)})`);
            nightGrad.addColorStop(0.4, `rgba(3, 8, 26, ${baseAlpha})`);
            nightGrad.addColorStop(1, `rgba(4, 10, 30, ${Math.max(0.42, baseAlpha - 0.05)})`);
            ctx.fillStyle = nightGrad;
            ctx.fillRect(0, 0, width, height);

            // Twilight golden/amber glow along the horizon if dusk/dawn (-12 < elev < 0)
            if (elev > -12) {
              const twilightFactor = 1 - (-elev / 12);
              const twiGrad = ctx.createLinearGradient(0, height * 0.65, 0, height);
              twiGrad.addColorStop(0, "rgba(217, 119, 6, 0)");
              twiGrad.addColorStop(1, `rgba(217, 119, 6, ${0.16 * twilightFactor})`);
              ctx.fillStyle = twiGrad;
              ctx.fillRect(0, height * 0.65, width, height * 0.35);
            }

            // High-altitude stars in space on orbital view
            if (zoom <= 5.5) {
              for (let i = 0; i < 50; i++) {
                const sx = (i * 157.3 + 37) % width;
                const sy = (i * 223.7 + 61) % (height * 0.6);
                const twinkle = Math.sin(now / 320 + i) * 0.4 + 0.6;
                ctx.fillStyle = `rgba(241, 245, 249, ${twinkle * 0.65})`;
                ctx.fillRect(sx, sy, 1.5, 1.5);
              }
            }
          } else if (elev < 14) {
            // Golden hour warm tint
            const goldenFactor = (14 - elev) / 14;
            ctx.fillStyle = `rgba(245, 158, 11, ${goldenFactor * 0.12})`;
            ctx.fillRect(0, 0, width, height);
          }
          ctx.restore();

          // C. Living Night City Lights & Highway Arteries Illumination
          if (elev < 0) {
            const nightFactor = Math.min(1, Math.max(0, -elev / 15));
            drawNightCityLights(ctx, map, nightFactor, now, width, height);
          }

          // Physical MapLibre satellite tile brightness synchronization (throttled to 5s to eliminate WebGL recompile overhead)
          if (now - lastBrightnessCheckRef.current > 5000) {
            lastBrightnessCheckRef.current = now;
            const satLayer = map.getLayer("satellite-tiles-layer") ? "satellite-tiles-layer" : map.getLayer("esri-satellite-layer") ? "esri-satellite-layer" : null;
            if (satLayer) {
              const nightFactor = Math.min(1, Math.max(0, -elev / 15));
              const targetBrightness = elev < 0 ? Math.max(0.38, 1.0 - nightFactor * 0.58) : 1.0;
              if (Math.abs(targetBrightness - lastAppliedBrightnessRef.current) > 0.03) {
                lastAppliedBrightnessRef.current = targetBrightness;
                try {
                  map.setPaintProperty(satLayer, "raster-brightness-max", targetBrightness);
                } catch {}
              }
            }
          }
        }

        // 1. Draw Selected Location Tactical Reticle if user selected a place on the map
        if (selectedLocationRef.current) {
          const selPt = map.project([selectedLocationRef.current.lon, selectedLocationRef.current.lat]);
          if (selPt.x >= -60 && selPt.x <= width + 60 && selPt.y >= -60 && selPt.y <= height + 60) {
            drawSelectedLocationReticle(ctx, selPt.x, selPt.y, now);
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

        // 1.5 Animated shockwaves for fresh impact events (< 6s old)
        for (const evt of impactsRef.current) {
          const elapsedMs = Math.max(0, now - evt.timestamp);
          if (elapsedMs < 6_000) {
            const pt = map.project([evt.lon, evt.lat]);
            if (pt.x >= -60 && pt.x <= width + 60 && pt.y >= -60 && pt.y <= height + 60) {
              const isImpact = evt.type === "impact";
              const pulsePhase = (now % 1200) / 1200;
              const ringRadius = 8 + pulsePhase * 16;
              const ringAlpha = Math.max(0, (1 - pulsePhase) * 0.65);
              ctx.beginPath();
              ctx.arc(pt.x, pt.y, ringRadius, 0, Math.PI * 2);
              ctx.strokeStyle = isImpact ? `rgba(239, 68, 68, ${ringAlpha})` : `rgba(6, 182, 212, ${ringAlpha})`;
              ctx.lineWidth = 1.4;
              ctx.stroke();
            }
          }
        }

        // 2. Camera target tracking & selected lock reticle
        if (followingTargetIdRef.current) {
          const follow = currentPackets.find((p) => p[0] === followingTargetIdRef.current);
          if (follow) {
            map.easeTo({ center: [follow[3], follow[2]], duration: 80, easing: (t) => t });
          }
        }

        if (currentSelected) {
          const selPt = map.project([currentSelected[3], currentSelected[2]]);
          if (selPt.x >= -60 && selPt.x <= width + 60 && selPt.y >= -60 && selPt.y <= height + 60) {
            drawLockReticle(ctx, selPt.x, selPt.y, (now / 40) % 360);
          }
        }

        // 2.2 Draw Air Targets (Shahed, Missile, Recon, KAB, FPV, Jet, Helicopter) & Trajectory Vectors
        const placedPillBoxes: PillRect[] = [];
        for (const packet of currentPackets) {
          const [id, type, lat, lon, heading, speed, , , , , altitude, packetModel] = packet;

          if (currentFilters) {
            if (type === "uav" && !currentFilters.uav) continue;
            if (type === "munition" && !currentFilters.munition) continue;
            if (type === "bomb" && currentFilters.bomb === false) continue;
            if (type === "fpv" && currentFilters.fpv === false) continue;
            if (type === "aircraft" && !currentFilters.aircraft) continue;
            if (type === "helicopter" && (currentFilters.helicopter !== undefined ? !currentFilters.helicopter : !currentFilters.aircraft)) continue;
          }

          const groundPoint = map.project([lon, lat]);

          if (
            groundPoint.x < -80 ||
            groundPoint.x > width + 80 ||
            groundPoint.y < -80 ||
            groundPoint.y > height + 80
          ) {
            continue;
          }

          const scale = Math.max(12, Math.min(22, 10 + zoom * 0.85));
          const targetX = groundPoint.x;
          const targetY = groundPoint.y;

          const mapBearing = map.getBearing() || 0;
          const screenHeadingDeg = (heading - mapBearing + 360) % 360;
          const headingRad = (screenHeadingDeg * Math.PI) / 180;
          const fwdX = Math.sin(headingRad);
          const fwdY = -Math.cos(headingRad);

          const isSelected = Boolean(currentSelected && currentSelected[0] === id);
          const isHighThreat = type === "uav" || type === "munition" || type === "bomb" || type === "fpv";

          let color = "#7dd3fc";
          if (type === "uav") color = "#ef4444";
          if (type === "munition") color = "#f97316";
          if (type === "bomb") color = "#ef4444";
          if (type === "fpv") color = "#d946ef";
          if (type === "helicopter") color = "#10b981";

          // Forward flight trajectory vector (strictly leading forward out of silhouette nose)
          if (speed > 5) {
            const noseDist = scale * 0.95;
            const vectorLen = Math.max(16, Math.min(38, 12 + zoom * 2.0));
            const startX = targetX + fwdX * noseDist;
            const startY = targetY + fwdY * noseDist;
            const tipX = targetX + fwdX * (noseDist + vectorLen);
            const tipY = targetY + fwdY * (noseDist + vectorLen);

            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.6;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();

            // Small waypoint tick dot at tip
            ctx.beginPath();
            ctx.arc(tipX, tipY, 2.2, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.restore();
          }

          // Draw Military Silhouette strictly pointing in flight direction
          if (type === "uav") {
            drawUavSilhouette(ctx, targetX, targetY, scale, screenHeadingDeg, color, now, packetModel);
          } else if (type === "bomb") {
            drawKabSilhouette(ctx, targetX, targetY, scale, screenHeadingDeg, color, now);
          } else if (type === "fpv") {
            drawFpvSilhouette(ctx, targetX, targetY, scale, screenHeadingDeg, color, now);
          } else if (type === "munition") {
            drawMissileSilhouette(ctx, targetX, targetY, scale, screenHeadingDeg, color, now);
          } else if (type === "helicopter") {
            drawHelicopterSilhouette(ctx, targetX, targetY, scale, screenHeadingDeg, color, now);
          } else {
            drawAircraftSilhouette(ctx, targetX, targetY, scale, screenHeadingDeg, color, now);
          }

          // Target Tag & Telemetry: Crisp, non-colliding military pill
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

          const shortName = packetModel
            ? packetModel.replace(" Cruise Missile", "").replace(" Fighting Falcon", "").replace(" Fulcrum", "").replace(" (Jet)", "-Jet")
            : type === "uav"
            ? "Shahed-136"
            : type === "bomb"
            ? "КАБ-500"
            : type === "fpv"
            ? "FPV-дрон"
            : type === "munition"
            ? "Х-101"
            : type === "helicopter"
            ? "Ка-52"
            : id.startsWith("adsb-")
            ? id.slice(5).toUpperCase()
            : "Су-34М";

          if (isSelected) {
            drawLockReticle(ctx, targetX, targetY, (now / 40) % 360);
            drawMilitaryCalloutPill(
              ctx,
              targetX,
              targetY,
              `🎯 ${shortName}`,
              speedKmh,
              altMsl,
              color,
              true,
              true,
              placedPillBoxes
            );
          } else if (zoom >= 8.0) {
            drawMilitaryCalloutPill(
              ctx,
              targetX,
              targetY,
              shortName,
              speedKmh,
              altMsl,
              color,
              isHighThreat,
              true,
              placedPillBoxes
            );
          } else if (zoom >= 6.0 && isHighThreat) {
            drawMilitaryCalloutPill(
              ctx,
              targetX,
              targetY,
              shortName,
              speedKmh,
              altMsl,
              color,
              isHighThreat,
              false,
              placedPillBoxes
            );
          }
        }

        // 2.4 Draw Recent Impacts & Interceptions (< 15 min old)
        if (impactsRef.current && impactsRef.current.length > 0) {
          for (const evt of impactsRef.current) {
            const elapsedMs = Math.max(0, now - evt.timestamp);
            if (elapsedMs > 15 * 60 * 1000) continue;

            const pt = map.project([evt.lon, evt.lat]);
            if (pt.x < -80 || pt.x > width + 80 || pt.y < -80 || pt.y > height + 80) continue;

            const isImpact = evt.type === "impact";
            const minAgo = Math.max(1, Math.round(elapsedMs / 60000));
            const timeText = elapsedMs < 60000 ? "< 1 хв тому" : minAgo < 60 ? `${minAgo} хв тому` : `${Math.floor(minAgo / 60)} год тому`;
            const label = isImpact ? `💥 ПРИЛІТ (${timeText})` : `🛡️ ЗБИТТЯ (${timeText})`;

            drawTacticalImpactMarker(ctx, pt.x, pt.y, isImpact, label, now);
          }
        }

        // 3. Draw Active Reconnaissance Satellites (Persona-3, Bars-M, Lotos-S1, Kondor-FKA) - throttled to 1s
        if (showSatellitesRef.current !== false) {
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
          🎯 Клікніть на карті для встановлення точки спостереження
        </div>
      )}
      {followingTargetId && (
        <div className="following-prompt-pill">
          <span>🎯 СУПРОВОДЖЕННЯ: <strong>{followingTargetId.startsWith("adsb-") ? followingTargetId.slice(5).toUpperCase() : followingTargetId.toUpperCase()}</strong></span>
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
