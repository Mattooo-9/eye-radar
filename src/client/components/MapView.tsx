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
  showWaterShorelines?: boolean;
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
      maxzoom: 19
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
    // 1. High-Aspect Reconnaissance UAV (Supercam S350 / Orlan-10)
    ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
    ctx.shadowBlur = 4;

    ctx.fillStyle = "#1e293b"; // Dark composite body
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.14, size * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // High-aspect straight glider wings
    ctx.beginPath();
    ctx.rect(-size * 0.95, -size * 0.1, size * 1.9, size * 0.2);
    ctx.fill();
    ctx.stroke();

    // V-tail
    ctx.beginPath();
    ctx.moveTo(-size * 0.32, size * 0.62);
    ctx.lineTo(0, size * 0.48);
    ctx.lineTo(size * 0.32, size * 0.62);
    ctx.stroke();

    // Optical gimbal camera pod at nose
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(0, -size * 0.65, 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (isJet) {
    // 2. Shahed-238 Turbojet Powered Delta Wing (Matte stealth black + thermal exhaust)
    ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
    ctx.shadowBlur = 5;

    ctx.fillStyle = "#09090b"; // Stealth RAM coating
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.95);
    ctx.lineTo(size * 0.76, size * 0.5);
    ctx.lineTo(size * 0.76, size * 0.68); // Winglet fin
    ctx.lineTo(size * 0.64, size * 0.68);
    ctx.lineTo(size * 0.18, size * 0.48);
    ctx.lineTo(size * 0.12, size * 0.65); // Jet nozzle
    ctx.lineTo(-size * 0.12, size * 0.65);
    ctx.lineTo(-size * 0.18, size * 0.48);
    ctx.lineTo(-size * 0.64, size * 0.68);
    ctx.lineTo(-size * 0.76, size * 0.68);
    ctx.lineTo(-size * 0.76, size * 0.5);
    ctx.closePath();
    ctx.fill();

    // Glowing thermal warning border
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Dorsal air intake scoop
    ctx.fillStyle = "#ea580c";
    ctx.fillRect(-size * 0.08, -size * 0.12, size * 0.16, size * 0.24);

    // Turbojet afterburner flame plume
    const jetPlumeLen = size * (0.35 + Math.sin(timeMs / 18) * 0.1);
    ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
    ctx.beginPath();
    ctx.moveTo(-size * 0.1, size * 0.65);
    ctx.lineTo(0, size * 0.65 + jetPlumeLen);
    ctx.lineTo(size * 0.1, size * 0.65);
    ctx.closePath();
    ctx.fill();
  } else {
    // 3. Real Military Shahed-136 Kamikaze Delta Wing (Aerospace-grade realistic illustration)
    ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;

    // Delta wing base shape
    ctx.fillStyle = "#1e293b"; // Dark graphite composite RAM airframe
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.95); // Nose radome
    ctx.lineTo(size * 0.76, size * 0.48); // Right wingtip
    ctx.lineTo(size * 0.76, size * 0.65); // Right winglet trailing edge
    ctx.lineTo(size * 0.62, size * 0.65); // Right winglet base
    ctx.lineTo(size * 0.16, size * 0.45); // Right wing root trailing edge
    ctx.lineTo(size * 0.12, size * 0.58); // Propeller mount starboard
    ctx.lineTo(-size * 0.12, size * 0.58); // Propeller mount port
    ctx.lineTo(-size * 0.16, size * 0.45); // Left wing root trailing edge
    ctx.lineTo(-size * 0.62, size * 0.65); // Left winglet base
    ctx.lineTo(-size * 0.76, size * 0.65); // Left winglet trailing edge
    ctx.lineTo(-size * 0.76, size * 0.48); // Left wingtip
    ctx.closePath();
    ctx.fill();

    // Threat danger outline (red)
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Central fuselage spine fairing
    ctx.fillStyle = "#334155";
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.1, size * 0.14, size * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Wing structural panel lines
    ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.5);
    ctx.lineTo(size * 0.6, size * 0.42);
    ctx.moveTo(0, -size * 0.5);
    ctx.lineTo(-size * 0.6, size * 0.42);
    ctx.stroke();

    // Wingtip vertical stabilizer fins (with high-visibility tactical chevrons)
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(-size * 0.76, size * 0.42, 2.5, size * 0.22);
    ctx.fillRect(size * 0.76 - 2.5, size * 0.42, 2.5, size * 0.22);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(-size * 0.76, size * 0.42, 2.5, size * 0.08);
    ctx.fillRect(size * 0.76 - 2.5, size * 0.42, 2.5, size * 0.08);

    // Nose optical sensor / guidance radome
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, -size * 0.85, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Rear MD-550 pusher propeller disc (spinning)
    const propAngle = (timeMs / 10) % 360;
    ctx.save();
    ctx.translate(0, size * 0.58);
    ctx.rotate((propAngle * Math.PI) / 180);
    ctx.strokeStyle = "rgba(254, 202, 202, 0.85)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-size * 0.24, 0);
    ctx.lineTo(size * 0.24, 0);
    ctx.stroke();
    // Central propeller hub
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
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

    // 5. Water Shorelines & Reservoirs: Distinct tactical boundary on water/land border
    if (!map.getSource("ukraine-water-shorelines")) {
      map.addSource("ukraine-water-shorelines", {
        type: "geojson",
        data: "/ukraine-water-shorelines.geojson"
      });
    }

    if (!map.getLayer("ukraine-water-shorelines-glow")) {
      map.addLayer({
        id: "ukraine-water-shorelines-glow",
        type: "line",
        source: "ukraine-water-shorelines",
        paint: {
          "line-color": "#0ea5e9",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 3.5, 8, 6.0, 12, 9.0],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 4, 2.0, 8, 3.5, 12, 5.0],
          "line-opacity": 0.55
        }
      });
    }

    if (!map.getLayer("ukraine-water-shorelines-line")) {
      map.addLayer({
        id: "ukraine-water-shorelines-line",
        type: "line",
        source: "ukraine-water-shorelines",
        paint: {
          "line-color": "#38bdf8",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 8, 2.0, 12, 2.8],
          "line-opacity": 0.85
        }
      });
    }

    if (!map.getLayer("ukraine-water-shorelines-core")) {
      map.addLayer({
        id: "ukraine-water-shorelines-core",
        type: "line",
        source: "ukraine-water-shorelines",
        paint: {
          "line-color": "#e0f2fe",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 8, 1.0, 12, 1.4],
          "line-opacity": 0.95
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
  showWaterShorelines = true,
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

  const showWaterShorelinesRef = useRef(showWaterShorelines);
  showWaterShorelinesRef.current = showWaterShorelines;

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
      const clickX = e.point.x;
      const clickY = e.point.y;

      // Check impacts first
      for (const evt of impactsRef.current) {
        const pt = map.project([evt.lon, evt.lat]);
        const dist = Math.hypot(pt.x - clickX, pt.y - clickY);
        if (dist < 32) {
          onSelectImpactRef.current?.(evt);
          window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
          return;
        }
      }

      if (isPickingLocationRef.current) {
        onPickLocationRef.current?.(e.lngLat.lat, e.lngLat.lng);
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
        return;
      }

      const currentZoom = map.getZoom();
      let closest: TrackPacket | null = null;
      let minDistance = 38;

      for (const packet of packetsRef.current) {
        const [, , lat, lon] = packet;
        const ground = map.project([lon, lat]);
        const dist = Math.hypot(ground.x - clickX, ground.y - clickY);

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
    });
    map.on("click", handleMapClick);

    // Initial resize right away
    resizeCanvasSafe();

    return () => {
      window.removeEventListener("resize", handleWindowResize);
      window.Telegram?.WebApp?.offEvent?.("viewportChanged", handleWindowResize);
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

  // 4. Water Shorelines layer visibility synchronization
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visibility = showWaterShorelines !== false ? "visible" : "none";
    const layerIds = ["ukraine-water-shorelines-glow", "ukraine-water-shorelines-line", "ukraine-water-shorelines-core"];
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
  }, [showWaterShorelines, visionMode]);

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

  // 4. Smooth 30 FPS Canvas overlay render loop (optimized for low-end mobile & Telegram WebApp)
  useEffect(() => {
    let animId: number;
    let lastAudioCheck = 0;
    let lastFrameTime = 0;
    const TARGET_FPS = 30;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;

    const render = (time = performance.now()) => {
      animId = requestAnimationFrame(render);
      if (time - lastFrameTime < FRAME_INTERVAL) {
        return;
      }
      lastFrameTime = time;

      renderRef.current = () => render(performance.now());
      const map = mapRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");

      if (map && canvas && ctx && canvas.width > 0 && canvas.height > 0) {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
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

        // 1.5 Draw Recent Impacts & Air-Defense Interceptions with animated shockwaves
        for (const evt of impactsRef.current) {
          const pt = map.project([evt.lon, evt.lat]);
          if (pt.x >= -60 && pt.x <= width + 60 && pt.y >= -60 && pt.y <= height + 60) {
            drawImpactEvent(ctx, pt.x, pt.y, evt, now);
          }
        }

        // 2. Draw Air Targets with exact military silhouettes & forward trajectories
        const placedPillBoxes: PillRect[] = [];
        for (const packet of currentPackets) {
          const [id, type, lat, lon, heading, speed, timestamp, , , , altitude, packetModel, packetCallsign] = packet;

          if (currentFilters) {
            if (type === "uav" && !currentFilters.uav) continue;
            if (type === "munition" && !currentFilters.munition) continue;
            if (type === "aircraft" && !currentFilters.aircraft) continue;
            if (type === "helicopter" && (currentFilters.helicopter !== undefined ? !currentFilters.helicopter : !currentFilters.aircraft)) continue;
          }

          // Exact physical ground coordinates anchored directly to geographic location
          const groundPoint = map.project([lon, lat]);

          // Real-time camera target lock & tracking
          if (followingTargetIdRef.current && followingTargetIdRef.current === id) {
            map.easeTo({ center: [lon, lat], duration: 80, easing: (t) => t });
          }

          if (
            groundPoint.x < -100 ||
            groundPoint.x > width + 100 ||
            groundPoint.y < -100 ||
            groundPoint.y > height + 100
          ) {
            continue;
          }

          // Geometrical scale strictly calibrated: 13px at regional view, max 19px at close tactical view
          const scale =
            zoom < 6.0
              ? 13.0
              : zoom < 8.5
              ? 15.0
              : zoom < 11.5
              ? 17.0
              : 19.0;

          // Subpixel-locked target coordinates directly anchored to geographic ground coordinates
          const targetX = groundPoint.x;
          const targetY = groundPoint.y;

          // Camera-adjusted true flight heading (0° = North/Up, 90° = East/Right, 180° = South/Down, 270° = West/Left)
          const mapBearing = map.getBearing() || 0;
          const screenHeadingDeg = (heading - mapBearing + 360) % 360;
          const headingRad = (screenHeadingDeg * Math.PI) / 180;
          const fwdX = Math.sin(headingRad);
          const fwdY = -Math.cos(headingRad);

          // Scale Level-of-Detail (LOD)
          const isSelected = Boolean(currentSelected && currentSelected[0] === id);
          const isHighThreat = type === "uav" || type === "munition" || type === "bomb" || type === "fpv";
          const isLowZoom = zoom < 4.8;

          let color = "#7dd3fc";
          if (type === "uav") color = "#ef4444";
          if (type === "munition") color = "#f97316";
          if (type === "bomb") color = "#ef4444";
          if (type === "fpv") color = "#d946ef";
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

          // Subtle ground nadir reference point
          ctx.save();
          ctx.beginPath();
          ctx.arc(targetX, targetY, 2, 0, Math.PI * 2);
          ctx.fillStyle = isHighThreat ? "#ef4444" : "#38bdf8";
          ctx.fill();
          ctx.restore();

          // Forward flight trajectory vector (strictly leading forward out of silhouette nose)
          if (speed > 5) {
            const noseDist = scale * 0.95;
            const vectorLen = zoom < 6.5 ? 18 : zoom < 9 ? 24 : 32;
            const startX = targetX + fwdX * noseDist;
            const startY = targetY + fwdY * noseDist;
            const tipX = targetX + fwdX * (noseDist + vectorLen);
            const tipY = targetY + fwdY * (noseDist + vectorLen);

            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.3;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();

            // Small waypoint tick dot at tip
            ctx.beginPath();
            ctx.arc(tipX, tipY, 2, 0, Math.PI * 2);
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
            drawMissileSilhouette(ctx, targetX, targetY, scale, screenHeadingDeg, color);
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
          } else if (zoom >= 8.5) {
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
          } else if (zoom >= 7.0 && isHighThreat) {
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
