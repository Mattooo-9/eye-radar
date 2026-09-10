import { useEffect, useRef } from "react";
import maplibregl, { type Map } from "maplibre-gl";
import type { TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { destinationPoint, haversineMeters } from "../lib/geo";
import { soundEngine } from "../lib/sound";
import { getSubsolarPoint, getTerminatorCoordinates, getLocalSolarStatus } from "../lib/solarTerminator";
import { findNearestLandmark } from "../lib/landmarks";
import { getLiveWeatherRadarTileUrl } from "../lib/weatherRadar";
import { calculateSatellitePositions, type SatelliteTrack } from "../lib/satelliteRecon";
import { getUkraineBordersGeoJSON } from "../lib/ukraineBorders";
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
  followingTargetId?: string | null;
  onStopFollow?: () => void;
  onMapReady?: (map: Map) => void;
  selectedLocation?: { lat: number; lon: number } | null;
  onSelectTarget?: (packet: TrackPacket) => void;
  onSelectLocation?: (lat: number, lon: number) => void;
  onPickLocation?: (lat: number, lon: number) => void;
}

const SATELLITE_STYLE = {
  version: 8 as const,
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
      maxzoom: 20
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

const drawUavSilhouette = (
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

  // Shahed-136 delta wing with swept leading edge & straight trailing edge
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.9);
  ctx.lineTo(size * 0.72, size * 0.5);
  ctx.lineTo(size * 0.72, size * 0.65); // Wingtip vertical stabilizer
  ctx.lineTo(size * 0.62, size * 0.65);
  ctx.lineTo(size * 0.15, size * 0.45);
  ctx.lineTo(0, size * 0.58); // Central pusher propeller mount
  ctx.lineTo(-size * 0.15, size * 0.45);
  ctx.lineTo(-size * 0.62, size * 0.65);
  ctx.lineTo(-size * 0.72, size * 0.65);
  ctx.lineTo(-size * 0.72, size * 0.5);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Wingtip vertical stabilizer fins
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-size * 0.72, size * 0.42, 2.5, size * 0.22);
  ctx.fillRect(size * 0.72 - 2.5, size * 0.42, 2.5, size * 0.22);

  // Rear pusher propeller disk
  const propAngle = (timeMs / 12) % 360;
  ctx.save();
  ctx.translate(0, size * 0.58);
  ctx.rotate((propAngle * Math.PI) / 180);
  ctx.strokeStyle = "rgba(254, 202, 202, 0.75)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-size * 0.25, 0);
  ctx.lineTo(size * 0.25, 0);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
};

const drawMissileSilhouette = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number,
  color: string
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);

  // Cruise missile body (Kh-101 / Kalibr)
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.0); // Radome ogive nose
  ctx.lineTo(size * 0.16, -size * 0.65);
  ctx.lineTo(size * 0.16, -size * 0.15);
  ctx.lineTo(size * 0.7, -size * 0.05); // Deployed cruise wing
  ctx.lineTo(size * 0.7, size * 0.05);
  ctx.lineTo(size * 0.16, 0);
  ctx.lineTo(size * 0.16, size * 0.6);
  ctx.lineTo(size * 0.38, size * 0.75); // Tail fin
  ctx.lineTo(size * 0.38, size * 0.82);
  ctx.lineTo(size * 0.14, size * 0.75);
  ctx.lineTo(0, size * 0.72);
  ctx.lineTo(-size * 0.14, size * 0.75);
  ctx.lineTo(-size * 0.38, size * 0.82);
  ctx.lineTo(-size * 0.38, size * 0.75);
  ctx.lineTo(-size * 0.16, size * 0.6);
  ctx.lineTo(-size * 0.16, 0);
  ctx.lineTo(-size * 0.7, size * 0.05);
  ctx.lineTo(-size * 0.7, -size * 0.05);
  ctx.lineTo(-size * 0.16, -size * 0.15);
  ctx.lineTo(-size * 0.16, -size * 0.65);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Missile nose radome tip
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -size * 0.95, 1.5, 0, Math.PI * 2);
  ctx.fill();

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

  // High-fidelity Civil/Military Jet Aircraft
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.95); // Nose cone
  ctx.lineTo(size * 0.14, -size * 0.55);
  ctx.lineTo(size * 0.14, -size * 0.15);
  ctx.lineTo(size * 0.85, size * 0.28); // Swept main wing
  ctx.lineTo(size * 0.85, size * 0.38);
  ctx.lineTo(size * 0.18, size * 0.22);
  ctx.lineTo(size * 0.18, size * 0.68);
  ctx.lineTo(size * 0.42, size * 0.85); // Horizontal stabilizer
  ctx.lineTo(size * 0.42, size * 0.92);
  ctx.lineTo(0, size * 0.80); // Tail cone
  ctx.lineTo(-size * 0.42, size * 0.92);
  ctx.lineTo(-size * 0.42, size * 0.85);
  ctx.lineTo(-size * 0.18, size * 0.68);
  ctx.lineTo(-size * 0.18, size * 0.22);
  ctx.lineTo(-size * 0.85, size * 0.38);
  ctx.lineTo(-size * 0.85, size * 0.28);
  ctx.lineTo(-size * 0.14, -size * 0.15);
  ctx.lineTo(-size * 0.14, -size * 0.55);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.88)";
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Cockpit glass canopy highlight
  ctx.fillStyle = "#bae6fd";
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.65, size * 0.08, size * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  // Turbofan engine nacelles under wings
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillRect(-size * 0.38, size * 0.18, size * 0.1, size * 0.24);
  ctx.fillRect(size * 0.28, size * 0.18, size * 0.1, size * 0.24);

  // Navigation Lights: Left Wing Port (RED), Right Wing Starboard (GREEN)
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(-size * 0.85, size * 0.33, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#22c55e";
  ctx.beginPath();
  ctx.arc(size * 0.85, size * 0.33, 2, 0, Math.PI * 2);
  ctx.fill();

  // Anti-collision strobe flashing at tail
  const isStrobeOn = timeMs % 1000 < 130;
  if (isStrobeOn) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, size * 0.80, 2.5, 0, Math.PI * 2);
    ctx.fill();
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

  // Helicopter Cabin & Cockpit
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.15, size * 0.28, size * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.88)";
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Cockpit glass
  ctx.fillStyle = "#bae6fd";
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.42, size * 0.16, size * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail Boom & Fin
  ctx.beginPath();
  ctx.moveTo(0, size * 0.35);
  ctx.lineTo(0, size * 0.98);
  ctx.lineTo(size * 0.24, size * 0.98);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.8;
  ctx.stroke();

  // Tail rotor
  const tailRotorAngle = (timeMs / 10) % 360;
  ctx.save();
  ctx.translate(size * 0.24, size * 0.98);
  ctx.rotate((tailRotorAngle * Math.PI) / 180);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.22);
  ctx.lineTo(0, size * 0.22);
  ctx.stroke();
  ctx.restore();

  // Main 4-blade rotor disk with motion blur
  const rotorAngle = (timeMs / 16) % 360;
  ctx.save();
  ctx.translate(0, -size * 0.15);
  ctx.rotate((rotorAngle * Math.PI) / 180);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.95);
  ctx.lineTo(0, size * 0.95);
  ctx.moveTo(-size * 0.95, 0);
  ctx.lineTo(size * 0.95, 0);
  ctx.stroke();
  // Central rotor mast
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
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
    ? `${modelName} • ${speedKmh} км/г • ${altStr}`
    : `${modelName} • ${speedKmh} км/г`;

  ctx.font = "bold 10px Inter, -apple-system, system-ui, sans-serif";
  const metrics = ctx.measureText(text);
  const pillW = Math.max(85, Math.ceil(metrics.width) + 18);
  const pillH = 18;

  // Anti-collision candidate slots around target center
  const candidates: Array<{ x: number; y: number }> = [
    { x: targetX + 14, y: Math.round(targetY - pillH / 2) }, // Right
    { x: targetX + 14, y: Math.round(targetY - pillH / 2 - 20) }, // Right-Up
    { x: targetX + 14, y: Math.round(targetY - pillH / 2 + 20) }, // Right-Down
    { x: targetX - pillW - 14, y: Math.round(targetY - pillH / 2) }, // Left
    { x: targetX - pillW - 14, y: Math.round(targetY - pillH / 2 - 20) }, // Left-Up
    { x: targetX - pillW - 14, y: Math.round(targetY - pillH / 2 + 20) }, // Left-Down
    { x: Math.round(targetX - pillW / 2), y: targetY - pillH - 12 }, // Top
    { x: Math.round(targetX - pillW / 2), y: targetY + 14 } // Bottom
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

  if (!foundNonColliding) {
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

  // Subtle lead connector line from target to pill
  ctx.strokeStyle = isThreat ? "rgba(239, 68, 68, 0.5)" : "rgba(56, 189, 248, 0.4)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  if (px > targetX) {
    ctx.moveTo(targetX + 4, targetY);
    ctx.lineTo(px, py + 9);
  } else if (px + pillW < targetX) {
    ctx.moveTo(targetX - 4, targetY);
    ctx.lineTo(px + pillW, py + 9);
  } else {
    ctx.moveTo(targetX, targetY > py ? targetY - 4 : targetY + 4);
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

const drawTacticalGlassBadge = (
  ctx: CanvasRenderingContext2D,
  airX: number,
  airY: number,
  displayId: string,
  speedKmh: number,
  speedKnots: number,
  altMsl: string,
  altFt: number,
  heading: number,
  landmark: string,
  isThreat: boolean
) => {
  ctx.save();
  const ratio = window.devicePixelRatio || 1;
  const screenW = ctx.canvas.width / ratio;
  const screenH = ctx.canvas.height / ratio;

  const panelW = 196;
  const panelH = 74;
  const panelX = airX + 22 + panelW > screenW - 12 ? airX - panelW - 20 : airX + 22;
  const panelY = Math.max(12, Math.min(screenH - panelH - 12, airY - 37));

  // Background glass fill
  ctx.fillStyle = "rgba(11, 18, 32, 0.95)";
  ctx.strokeStyle = isThreat ? "rgba(239, 68, 68, 0.9)" : "rgba(56, 189, 248, 0.85)";
  ctx.lineWidth = 1.4;

  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, 6);
  ctx.fill();
  ctx.stroke();

  // Top header highlight bar
  ctx.fillStyle = isThreat ? "rgba(239, 68, 68, 0.35)" : "rgba(56, 189, 248, 0.28)";
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, 19, [6, 6, 0, 0]);
  ctx.fill();

  // Lead pointer line from air target to glass badge
  ctx.strokeStyle = isThreat ? "rgba(239, 68, 68, 0.75)" : "rgba(56, 189, 248, 0.7)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (panelX < airX) {
    ctx.moveTo(airX - 8, airY);
    ctx.lineTo(panelX + panelW, panelY + 14);
  } else {
    ctx.moveTo(airX + 8, airY);
    ctx.lineTo(panelX, panelY + 14);
  }
  ctx.stroke();

  // Title
  ctx.font = "bold 10px Inter, monospace";
  ctx.fillStyle = isThreat ? "#fca5a5" : "#bae6fd";
  ctx.fillText(displayId, panelX + 8, panelY + 14);

  // Flight Telemetry & Altitude Corridor
  ctx.font = "9px Inter, monospace";
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(`V: ${speedKmh} км/год (${speedKnots} kts)`, panelX + 8, panelY + 33);

  const altColor = isThreat ? "#f87171" : "#7dd3fc";
  ctx.fillStyle = altColor;
  ctx.fillText(`H: ${altMsl} (${altFt} ft) • CRS: ${Math.round(heading % 360)}°`, panelX + 8, panelY + 47);

  // Landmark proximity
  ctx.fillStyle = "rgba(148, 163, 184, 0.95)";
  const truncatedLandmark = landmark.length > 27 ? landmark.slice(0, 26) + "…" : landmark;
  ctx.fillText(`📍 ${truncatedLandmark}`, panelX + 8, panelY + 63);

  ctx.restore();
};

const syncWeatherLayer = async (map: maplibregl.Map, visible: boolean) => {
  try {
    if (!map || !map.isStyleLoaded()) return;
    const tileUrl = await getLiveWeatherRadarTileUrl();
    if (!tileUrl || !map || !map.isStyleLoaded()) return;

    if (!map.getSource("rainviewer-radar")) {
      map.addSource("rainviewer-radar", {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        attribution: "RainViewer"
      });
    }

    if (!map.getLayer("rainviewer-radar-layer")) {
      const beforeLayer = map.getLayer("esri-reference-layer") ? "esri-reference-layer" : undefined;
      map.addLayer(
        {
          id: "rainviewer-radar-layer",
          type: "raster",
          source: "rainviewer-radar",
          paint: {
            "raster-opacity": 0.45,
            "raster-fade-duration": 300
          },
          layout: {
            visibility: visible ? "visible" : "none"
          }
        },
        beforeLayer
      );
    } else {
      map.setLayoutProperty(
        "rainviewer-radar-layer",
        "visibility",
        visible ? "visible" : "none"
      );
    }
  } catch {
    // Graceful fallback if weather radar tile fails
  }
};

const syncUkraineBorders = (map: maplibregl.Map) => {
  if (!map || !map.isStyleLoaded()) return;
  try {
    // 0. All World Countries Borders & Labels
    if (!map.getSource("world-borders")) {
      map.addSource("world-borders", {
        type: "geojson",
        data: "/world-borders.geojson"
      });
    }

    if (!map.getLayer("world-borders-line")) {
      map.addLayer({
        id: "world-borders-line",
        type: "line",
        source: "world-borders",
        paint: {
          "line-color": "#64748b",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.9, 6, 1.4, 10, 1.9],
          "line-opacity": 0.65
        }
      });
    }

    if (!map.getLayer("world-country-labels")) {
      map.addLayer({
        id: "world-country-labels",
        type: "symbol",
        source: "world-borders",
        layout: {
          "text-field": ["get", "NAME"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 6, 12, 10, 14],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.1,
          "text-max-width": 8
        },
        paint: {
          "text-color": "#94a3b8",
          "text-halo-color": "#020617",
          "text-halo-width": 1.5
        }
      });
    }

    if (!map.getSource("ukraine-borders")) {
      map.addSource("ukraine-borders", {
        type: "geojson",
        data: "/ukraine-official-borders.geojson"
      });
    }

    // 1. Soft Outer Tactical Glow for recognized state border
    if (!map.getLayer("ukraine-border-glow")) {
      map.addLayer({
        id: "ukraine-border-glow",
        type: "line",
        source: "ukraine-borders",
        filter: ["==", "type", "state_border"],
        paint: {
          "line-color": "#0284c7",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 4.5, 8, 7.5, 12, 11],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 8, 4.5, 12, 6.5],
          "line-opacity": 0.7
        }
      });
    }

    // 2. High-Contrast Tactical Oblast Divisions (All 24 Oblasts + Crimea)
    if (!map.getLayer("ukraine-oblast-borders")) {
      map.addLayer({
        id: "ukraine-oblast-borders",
        type: "line",
        source: "ukraine-borders",
        filter: ["==", "type", "oblast_border"],
        paint: {
          "line-color": "#38bdf8",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.0, 8, 1.6, 12, 2.2],
          "line-opacity": 0.65,
          "line-dasharray": [5, 4]
        }
      });
    }

    // 3. Sharp Luminous State Boundary Line
    if (!map.getLayer("ukraine-state-border")) {
      map.addLayer({
        id: "ukraine-state-border",
        type: "line",
        source: "ukraine-borders",
        filter: ["==", "type", "state_border"],
        paint: {
          "line-color": "#00f0ff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.0, 8, 3.2, 12, 4.2],
          "line-opacity": 0.95
        }
      });
    }

    // 4. Ultra-Crisp White Centerline Core for state border
    if (!map.getLayer("ukraine-state-border-core")) {
      map.addLayer({
        id: "ukraine-state-border-core",
        type: "line",
        source: "ukraine-borders",
        filter: ["==", "type", "state_border"],
        paint: {
          "line-color": "#f0fdfa",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 8, 1.3, 12, 1.8],
          "line-opacity": 0.88
        }
      });
    }
  } catch {
    // Graceful fallback if borders already present or WebGL busy
  }
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
  followingTargetId,
  onStopFollow,
  onMapReady,
  onSelectTarget,
  onSelectLocation,
  onPickLocation
}: MapViewProps) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const centeredRef = useRef(false);

  // Stable references to eliminate component re-render teardowns
  const packetsRef = useRef(packets);
  packetsRef.current = packets;

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

    const ratio = window.devicePixelRatio || 1;
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
      maxZoom: 18.5,
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

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      if (isPickingLocationRef.current) {
        onPickLocationRef.current?.(e.lngLat.lat, e.lngLat.lng);
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
        return;
      }

      const clickX = e.point.x;
      const clickY = e.point.y;
      const currentZoom = map.getZoom();

      let closest: TrackPacket | null = null;
      let minDistance = 38;

      for (const packet of packetsRef.current) {
        const [, type, lat, lon, heading, speed, timestamp, , , , altitude] = packet;
        const elapsedSeconds = Math.max(0, (Date.now() - timestamp) / 1000);
        const predicted = destinationPoint({ lat, lon }, heading, speed * elapsedSeconds);
        const ground = map.project([predicted.lon, predicted.lat]);

        const effAlt = altitude ?? (type === "aircraft" ? 9800 : type === "helicopter" ? 750 : 250);
        const altElev = Math.min(54, (effAlt / 1000) * (currentZoom * 0.7));
        const airPoint = { x: ground.x, y: ground.y - altElev };

        const distAir = Math.hypot(airPoint.x - clickX, airPoint.y - clickY);
        const distGround = Math.hypot(ground.x - clickX, ground.y - clickY);
        const dist = Math.min(distAir, distGround);

        if (dist < minDistance) {
          minDistance = dist;
          closest = packet;
        }
      }

      if (closest) {
        onSelectTargetRef.current?.(closest);
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
      } else {
        onSelectLocationRef.current?.(e.lngLat.lat, e.lngLat.lng);
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
      }
    };

    const handleWindowResize = () => {
      map.resize();
      resizeCanvasSafe();
    };

    window.addEventListener("resize", handleWindowResize);
    window.Telegram?.WebApp?.onEvent?.("viewportChanged", handleWindowResize);

    const onMapRedraw = () => {
      renderRef.current?.();
    };

    map.on("load", () => {
      resizeCanvasSafe();
      syncWeatherLayer(map, showWeatherRef.current !== false);
      syncUkraineBorders(map);
      const scaleControl = new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" });
      map.addControl(scaleControl, "bottom-right");
    });
    map.on("styledata", () => {
      syncUkraineBorders(map);
    });
    map.on("resize", () => {
      resizeCanvasSafe();
      renderRef.current?.();
    });
    map.on("render", onMapRedraw);
    map.on("move", onMapRedraw);
    map.on("zoom", onMapRedraw);
    map.on("click", handleMapClick);

    // Initial resize right away
    resizeCanvasSafe();

    return () => {
      window.removeEventListener("resize", handleWindowResize);
      window.Telegram?.WebApp?.offEvent?.("viewportChanged", handleWindowResize);
      map.off("render", onMapRedraw);
      map.off("move", onMapRedraw);
      map.off("zoom", onMapRedraw);
      map.off("click", handleMapClick);
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
        syncUkraineBorders(map);
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

  // 3. Smooth flyTo user location on first GPS acquisition
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

  // 4. Stable 60 FPS Canvas overlay render loop
  useEffect(() => {
    let animId: number;
    let lastAudioCheck = 0;

    const render = () => {
      renderRef.current = render;
      const map = mapRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");

      if (map && canvas && ctx && canvas.width > 0 && canvas.height > 0) {
        const ratio = window.devicePixelRatio || 1;
        const width = canvas.width / ratio;
        const height = canvas.height / ratio;

        // Clean frame clear without tearing
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

        // 2. Draw Air Targets with exact military silhouettes & forward trajectories
        const placedPillBoxes: PillRect[] = [];
        for (const packet of currentPackets) {
          const [id, type, lat, lon, heading, speed, timestamp, , , , altitude] = packet;

          if (currentFilters) {
            if (type === "uav" && !currentFilters.uav) continue;
            if (type === "munition" && !currentFilters.munition) continue;
            if (type === "aircraft" && !currentFilters.aircraft) continue;
            if (type === "helicopter" && (currentFilters.helicopter !== undefined ? !currentFilters.helicopter : !currentFilters.aircraft)) continue;
          }

          // Capped dead reckoning strictly prevents coordinate drift across network latency
          const elapsedSeconds = Math.min(4, Math.max(0, (now - timestamp) / 1000));
          const headingRad = (heading * Math.PI) / 180;
          const latRad = (lat * Math.PI) / 180;
          const cosLat = Math.cos(latRad);
          const metersPerDegLat = 111139;
          const metersPerDegLon = metersPerDegLat * (cosLat > 0.05 ? cosLat : 0.05);

          const vxMps = Math.sin(headingRad) * speed;
          const vyMps = Math.cos(headingRad) * speed;

          const predLat = lat + (vyMps * elapsedSeconds) / metersPerDegLat;
          const predLon = lon + (vxMps * elapsedSeconds) / metersPerDegLon;
          const groundPoint = map.project([predLon, predLat]);

          // Real-time camera target lock & tracking
          if (followingTargetIdRef.current && followingTargetIdRef.current === id) {
            map.easeTo({ center: [predLon, predLat], duration: 80, easing: (t) => t });
          }

          if (
            groundPoint.x < -100 ||
            groundPoint.x > width + 100 ||
            groundPoint.y < -100 ||
            groundPoint.y > height + 100
          ) {
            continue;
          }

          // Geometrically proportionate scale strictly preventing map obstruction on regional views
          const scale =
            zoom < 7.0
              ? 16.5
              : zoom < 10.0
              ? 18.0 + (zoom - 7.0) * 2.2
              : zoom < 14.0
              ? 25.0 + (zoom - 10.0) * 3.5
              : Math.min(84, 38.0 + (zoom - 14.0) * 8.0);

          // 3D Altitude perspective offset & Ground terrain projection
          const effectiveAltM =
            altitude !== undefined && altitude !== null
              ? altitude
              : type === "aircraft"
              ? 9800
              : type === "helicopter"
              ? 750
              : type === "munition"
              ? 450
              : 180;

          // Subpixel-locked target coordinates directly anchored to geographic ground coordinates
          const targetX = groundPoint.x;
          const targetY = groundPoint.y;

          // Geographically synchronized forward projection vector
          const futureSec = Math.max(15, Math.min(90, 450 / Math.max(1, zoom)));
          const futLat = predLat + (vyMps * futureSec) / metersPerDegLat;
          const futLon = predLon + (vxMps * futureSec) / metersPerDegLon;
          const futureProj = map.project([futLon, futLat]);

          // Screen heading strictly matching the projected vector on camera
          const vDx = futureProj.x - targetX;
          const vDy = futureProj.y - targetY;
          const vDist = Math.hypot(vDx, vDy);
          const screenHeadingDeg = vDist > 0.5 ? (Math.atan2(vDx, -vDy) * 180) / Math.PI : heading;

          // Scale Level-of-Detail (LOD)
          const isSelected = Boolean(currentSelected && currentSelected[0] === id);
          const isHighThreat = type === "uav" || type === "munition";
          const isLowZoom = zoom < 5.0;

          let color = "#7dd3fc";
          if (type === "uav") color = "#ef4444";
          if (type === "munition") color = "#f97316";
          if (type === "helicopter") color = "#10b981";
          if (type === "thermal") color = "#eab308";

          if (isLowZoom && !isSelected && !isHighThreat) {
            // Orbital blip: crisp tactical radar dot
            ctx.beginPath();
            ctx.arc(targetX, targetY, 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            continue;
          }

          // 1. EXACT GROUND NADIR ANCHOR PINPOINT (Ground Zero)
          ctx.save();
          const groundPulse = Math.sin(now / 240) * 0.3 + 0.7;
          ctx.beginPath();
          ctx.arc(targetX, targetY, zoom >= 10 ? 6.5 : 3.5, 0, Math.PI * 2);
          ctx.strokeStyle = isHighThreat ? `rgba(239, 68, 68, ${groundPulse})` : `rgba(56, 189, 248, ${groundPulse})`;
          ctx.lineWidth = 1.3;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(targetX, targetY, 2, 0, Math.PI * 2);
          ctx.fillStyle = isHighThreat ? "#ef4444" : "#38bdf8";
          ctx.fill();

          // Ground crosshair cardinal ticks
          const tick = zoom >= 10 ? 5 : 3;
          ctx.beginPath();
          ctx.moveTo(targetX - tick - 2, targetY);
          ctx.lineTo(targetX - 2, targetY);
          ctx.moveTo(targetX + 2, targetY);
          ctx.lineTo(targetX + tick + 2, targetY);
          ctx.moveTo(targetX, targetY - tick - 2);
          ctx.lineTo(targetX, targetY - 2);
          ctx.moveTo(targetX, targetY + 2);
          ctx.lineTo(targetX, targetY + tick + 2);
          ctx.stroke();
          ctx.restore();

          // Ultra-precise ground targeting reticle pinned directly to terrain
          if (zoom >= 10.5) {
            drawGroundReticle(ctx, targetX, targetY, isHighThreat, now);
          }

          // Subtle uncertainty cone ONLY on selected targets or high zoom (never blocking whole regions)
          if ((isSelected || zoom >= 11) && speed > 5) {
            drawUncertaintyCone(ctx, targetX, targetY, screenHeadingDeg, Math.min(36, vDist * 0.8));
          }

          if (type === "uav") {
            drawUavSilhouette(ctx, targetX, targetY, scale, screenHeadingDeg, color, now);
          } else if (type === "munition") {
            drawMissileSilhouette(ctx, targetX, targetY, scale, screenHeadingDeg, color);
          } else if (type === "helicopter") {
            drawHelicopterSilhouette(ctx, targetX, targetY, scale, screenHeadingDeg, color, now);
          } else {
            drawAircraftSilhouette(ctx, targetX, targetY, scale, screenHeadingDeg, color, now);
          }

          // Geographically synchronized velocity vector with 5-minute waypoint tick
          if (speed > 5 && vDist > 2) {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = zoom >= 10 ? 1.8 : 1.2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(targetX, targetY);
            ctx.lineTo(futureProj.x, futureProj.y);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(futureProj.x, futureProj.y, 2, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.restore();
          }

          // Target Tag & Telemetry: Crisp Military Pill or Selected Tactical Glass HUD Badge
          const speedKmh = Math.round(speed * 3.6);
          const altMsl = effectiveAltM >= 1000 ? `${(effectiveAltM / 1000).toFixed(1)} км` : `${Math.round(effectiveAltM)} м`;

          if (isSelected) {
            const modelName =
              type === "uav"
                ? "🔴 SHAHED-136 (БПЛА)"
                : type === "munition"
                ? "🟠 Х-101 / КАЛІБР"
                : type === "helicopter"
                ? "🟢 КА-52 / ВЕРТОЛЬОТ"
                : id.startsWith("adsb-")
                ? `FLIGHT ${id.slice(5).toUpperCase()}`
                : "🔵 СУ-34М (АВІАЦІЯ)";
            const speedKnots = Math.round(speed * 1.94384);
            const altFt = Math.round(effectiveAltM * 3.28084);
            const landmark = findNearestLandmark(predLat, predLon);
            drawTacticalGlassBadge(
              ctx,
              targetX,
              targetY,
              modelName,
              speedKmh,
              speedKnots,
              altMsl,
              altFt,
              heading,
              landmark,
              isHighThreat
            );
          } else if (isHighThreat || zoom >= 6.8 || (zoom >= 4.8 && !id.startsWith("adsb-"))) {
            const shortName =
              type === "uav"
                ? "Shahed-136"
                : type === "munition"
                ? "Х-101"
                : type === "helicopter"
                ? "Ка-52"
                : id.startsWith("adsb-")
                ? id.slice(5).toUpperCase()
                : "Су-34М";
            drawMilitaryCalloutPill(
              ctx,
              targetX,
              targetY,
              shortName,
              speedKmh,
              altMsl,
              color,
              isHighThreat,
              zoom >= 7.5,
              placedPillBoxes
            );
          }

          // Selected target Lock Reticle & 15-minute Intercept Vector
          if (currentSelected && currentSelected[0] === id) {
            drawLockReticle(ctx, targetX, targetY, (now / 40) % 360);

            if (speed > 5) {
              ctx.save();
              ctx.setLineDash([5, 5]);
              ctx.strokeStyle = "#38bdf8";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(targetX, targetY);

              const waypoints = [300, 600, 900];
              const wpCoords: Array<{ x: number; y: number; min: number }> = [];

              for (const sec of waypoints) {
                const wpLat = predLat + (vyMps * sec) / metersPerDegLat;
                const wpLon = predLon + (vxMps * sec) / metersPerDegLon;
                const wpProj = map.project([wpLon, wpLat]);
                ctx.lineTo(wpProj.x, wpProj.y);
                wpCoords.push({ x: wpProj.x, y: wpProj.y, min: sec / 60 });
              }
              ctx.stroke();
              ctx.restore();

              for (const wp of wpCoords) {
                ctx.beginPath();
                ctx.arc(wp.x, wp.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = "#38bdf8";
                ctx.fill();
                drawTextWithOutline(
                  ctx,
                  `+${wp.min}хв`,
                  wp.x + 6,
                  wp.y + 3,
                  "#e0f2fe",
                  "rgba(0, 0, 0, 0.9)",
                  "bold 10px monospace"
                );
              }
            }
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

      animId = requestAnimationFrame(render);
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
