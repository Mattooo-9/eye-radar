import { useEffect, useRef } from "react";
import maplibregl, { type Map } from "maplibre-gl";
import type { TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { destinationPoint, haversineMeters } from "../lib/geo";
import { soundEngine } from "../lib/sound";
import { getSubsolarPoint, getTerminatorCoordinates, getLocalSolarStatus } from "../lib/solarTerminator";
import { findNearestLandmark } from "../lib/landmarks";
import { getLiveWeatherRadarTileUrl } from "../lib/weatherRadar";
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
  onMapReady?: (map: Map) => void;
  onSelectTarget?: (packet: TrackPacket) => void;
  onPickLocation?: (lat: number, lon: number) => void;
}

const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    "esri-satellite": {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      ],
      tileSize: 256
    },
    "esri-hillshade": {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}"
      ],
      tileSize: 256
    },
    "esri-transportation": {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"
      ],
      tileSize: 256
    },
    "esri-reference": {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
      ],
      tileSize: 256
    }
  },
  layers: [
    {
      id: "esri-satellite-layer",
      type: "raster" as const,
      source: "esri-satellite",
      paint: {
        "raster-opacity": 1.0,
        "raster-fade-duration": 0
      }
    },
    {
      id: "esri-hillshade-layer",
      type: "raster" as const,
      source: "esri-hillshade",
      paint: {
        "raster-opacity": 0.28,
        "raster-fade-duration": 0
      }
    },
    {
      id: "esri-transportation-layer",
      type: "raster" as const,
      source: "esri-transportation",
      minzoom: 8,
      paint: {
        "raster-opacity": 0.85,
        "raster-fade-duration": 0
      }
    },
    {
      id: "esri-reference-layer",
      type: "raster" as const,
      source: "esri-reference",
      paint: {
        "raster-opacity": 0.9,
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
  const panelW = 168;
  const panelH = 70;
  const panelX = airX + 20;
  const panelY = airY - 35;

  // Background glass fill
  ctx.fillStyle = "rgba(11, 18, 32, 0.92)";
  ctx.strokeStyle = isThreat ? "rgba(239, 68, 68, 0.85)" : "rgba(56, 189, 248, 0.75)";
  ctx.lineWidth = 1.4;

  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, 5);
  ctx.fill();
  ctx.stroke();

  // Top header highlight bar
  ctx.fillStyle = isThreat ? "rgba(239, 68, 68, 0.32)" : "rgba(56, 189, 248, 0.25)";
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, 18, [5, 5, 0, 0]);
  ctx.fill();

  // Lead pointer line from air target to glass badge
  ctx.strokeStyle = isThreat ? "rgba(239, 68, 68, 0.7)" : "rgba(56, 189, 248, 0.6)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(airX + 8, airY);
  ctx.lineTo(panelX, panelY + 12);
  ctx.stroke();

  // Title
  ctx.font = "bold 10px monospace";
  ctx.fillStyle = isThreat ? "#fca5a5" : "#bae6fd";
  ctx.fillText(displayId, panelX + 7, panelY + 13);

  // Flight Telemetry
  ctx.font = "9px monospace";
  ctx.fillStyle = "#f1f5f9";
  ctx.fillText(`V: ${speedKmh} км/г (${speedKnots} kts)`, panelX + 7, panelY + 31);
  ctx.fillText(`H: ${altMsl} (${altFt} ft) • CRS: ${Math.round(heading % 360)}°`, panelX + 7, panelY + 45);

  // Landmark proximity
  ctx.fillStyle = "rgba(148, 163, 184, 0.95)";
  const truncatedLandmark = landmark.length > 24 ? landmark.slice(0, 23) + "…" : landmark;
  ctx.fillText(`📍 ${truncatedLandmark}`, panelX + 7, panelY + 60);

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
            "raster-opacity": 0.65,
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

export const MapView = ({
  packets,
  mapStyleUrl,
  location,
  filters,
  visionMode = "satellite",
  selectedTarget,
  isPickingLocation,
  showDayNight = true,
  showWeather = true,
  onMapReady,
  onSelectTarget,
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

  const isPickingLocationRef = useRef(isPickingLocation);
  isPickingLocationRef.current = isPickingLocation;

  const showDayNightRef = useRef(showDayNight);
  showDayNightRef.current = showDayNight;

  const showWeatherRef = useRef(showWeather);
  showWeatherRef.current = showWeather;

  const onSelectTargetRef = useRef(onSelectTarget);
  onSelectTargetRef.current = onSelectTarget;

  const onPickLocationRef = useRef(onPickLocation);
  onPickLocationRef.current = onPickLocation;

  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;

  const currentStyleRef = useRef<string | object | null>(null);

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
      maxZoom: 20,
      pitch: 52, // 3D orbital perspective
      bearing: -10,
      maxPitch: 85,
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

      if (!onSelectTargetRef.current) return;

      const clickX = e.point.x;
      const clickY = e.point.y;
      const currentZoom = map.getZoom();

      let closest: TrackPacket | null = null;
      let minDistance = 42;

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
        onSelectTargetRef.current(closest);
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
      pitch: 55,
      duration: 1500
    });
    centeredRef.current = true;
  }, [location]);

  // 4. Stable 60 FPS Canvas overlay render loop
  useEffect(() => {
    let animId: number;
    let lastAudioCheck = 0;

    const render = () => {
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

        // B. Planetary Solar Day/Night Terminator Mesh
        if (showDayNightRef.current !== false) {
          ctx.save();
          if (zoom <= 6.5) {
            const subsolar = getSubsolarPoint();
            const terminatorPts = getTerminatorCoordinates();
            const screenPoints: Array<{ x: number; y: number }> = [];

            for (const [tLon, tLat] of terminatorPts) {
              const pt = map.project([tLon, tLat]);
              screenPoints.push(pt);
            }

            if (screenPoints.length > 2) {
              // Determine polar darkness hemisphere
              const polarLat = subsolar.lat >= 0 ? -82 : 82;
              const pRight = map.project([180, polarLat]);
              const pLeft = map.project([-180, polarLat]);

              ctx.beginPath();
              ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
              for (let i = 1; i < screenPoints.length; i++) {
                ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
              }
              ctx.lineTo(pRight.x, pRight.y);
              ctx.lineTo(pLeft.x, pLeft.y);
              ctx.closePath();

              // Night hemisphere atmospheric shadow
              ctx.fillStyle = "rgba(4, 9, 20, 0.44)";
              ctx.fill();

              // Golden twilight terminator line (Dusk / Dawn boundary)
              ctx.beginPath();
              ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
              for (let i = 1; i < screenPoints.length; i++) {
                ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
              }
              ctx.strokeStyle = "rgba(251, 191, 36, 0.55)";
              ctx.lineWidth = 2.5;
              ctx.stroke();

              // Soft outer twilight glow
              ctx.strokeStyle = "rgba(245, 158, 11, 0.2)";
              ctx.lineWidth = 8;
              ctx.stroke();
            }

            // Subsolar Point Indicator (☀️ Zenith)
            const sunPt = map.project([subsolar.lon, subsolar.lat]);
            if (sunPt.x >= -60 && sunPt.x <= width + 60 && sunPt.y >= -60 && sunPt.y <= height + 60) {
              ctx.beginPath();
              ctx.arc(sunPt.x, sunPt.y, 6, 0, Math.PI * 2);
              ctx.fillStyle = "#fef08a";
              ctx.fill();
              ctx.strokeStyle = "rgba(250, 204, 21, 0.45)";
              ctx.lineWidth = 4;
              ctx.stroke();
            }

            // Anti-solar Point Indicator (🌙 Midnight)
            const antiLon = ((((subsolar.lon + 180) + 180) % 360) + 360) % 360 - 180;
            const antiLat = -subsolar.lat;
            const moonPt = map.project([antiLon, antiLat]);
            if (moonPt.x >= -60 && moonPt.x <= width + 60 && moonPt.y >= -60 && moonPt.y <= height + 60) {
              ctx.beginPath();
              ctx.arc(moonPt.x, moonPt.y, 5, 0, Math.PI * 2);
              ctx.fillStyle = "#93c5fd";
              ctx.fill();
            }
          } else {
            // Local tactical scale: seamless realistic natural lighting without artificial text tags
            const center = map.getCenter();
            const localSun = getLocalSolarStatus(center.lat, center.lng);
            const elev = localSun.elevationDeg;

            if (elev < 0) {
              // Twilight transition (0 to -12 deg) smoothly darkens into deep night
              const nightFactor = Math.min(1, Math.max(0, -elev / 12));
              if (nightFactor < 1) {
                // Golden-dusk twilight haze
                ctx.fillStyle = `rgba(180, 83, 9, ${0.14 * (1 - nightFactor)})`;
                ctx.fillRect(0, 0, width, height);
              }
              // Dark night atmosphere (preserving city lights / highways on satellite)
              ctx.fillStyle = `rgba(2, 6, 20, ${0.15 + nightFactor * 0.32})`;
              ctx.fillRect(0, 0, width, height);
            } else if (elev < 15) {
              // Sunrise / sunset golden hour warm rim lighting
              const goldenFactor = (15 - elev) / 15;
              ctx.fillStyle = `rgba(245, 158, 11, ${goldenFactor * 0.10})`;
              ctx.fillRect(0, 0, width, height);
            }
          }
          ctx.restore();
        }

        // 1. Draw True Geodesic Perspective Range Rings around observer
        if (currentLoc) {
          const userPoint = map.project([currentLoc.lon, currentLoc.lat]);
          const rings = [15_000, 30_000, 50_000];

          ctx.save();
          for (const radiusM of rings) {
            let labelPt: { x: number; y: number } | null = null;
            let firstPt: { x: number; y: number } | null = null;

            ctx.beginPath();
            for (let deg = 0; deg <= 360; deg += 10) {
              const ptGeo = destinationPoint(currentLoc, deg, radiusM);
              const ptProj = map.project([ptGeo.lon, ptGeo.lat]);
              if (deg === 0) {
                firstPt = ptProj;
                ctx.moveTo(ptProj.x, ptProj.y);
              } else {
                ctx.lineTo(ptProj.x, ptProj.y);
              }
              if (deg === 90) {
                labelPt = ptProj;
              }
            }
            ctx.closePath();
            ctx.strokeStyle = "rgba(59, 130, 246, 0.38)";
            ctx.lineWidth = 1.2;
            ctx.setLineDash([5, 5]);
            ctx.stroke();

            if (labelPt && firstPt && Math.hypot(labelPt.x - firstPt.x, labelPt.y - firstPt.y) >= 42) {
              drawTextWithOutline(
                ctx,
                `${radiusM / 1000} км`,
                labelPt.x + 4,
                labelPt.y + 3,
                "rgba(147, 197, 253, 0.9)",
                "rgba(0, 0, 0, 0.85)",
                "10px Inter, monospace"
              );
            }
          }
          ctx.restore();

          // User GPS Marker with breathing radar pulse
          const userPulse = Math.sin(now / 300) * 3 + 7;
          ctx.beginPath();
          ctx.fillStyle = "#22c55e";
          ctx.arc(userPoint.x, userPoint.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(34, 197, 94, 0.35)";
          ctx.lineWidth = userPulse;
          ctx.stroke();
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
        for (const packet of currentPackets) {
          const [id, type, lat, lon, heading, speed, timestamp, , , , altitude] = packet;

          if (currentFilters) {
            if (type === "uav" && !currentFilters.uav) continue;
            if (type === "munition" && !currentFilters.munition) continue;
            if ((type === "aircraft" || type === "helicopter") && !currentFilters.aircraft) continue;
          }

          const elapsedSeconds = Math.max(0, (now - timestamp) / 1000);
          const predicted = destinationPoint({ lat, lon }, heading, speed * elapsedSeconds);
          const groundPoint = map.project([predicted.lon, predicted.lat]);

          if (
            groundPoint.x < -100 ||
            groundPoint.x > width + 100 ||
            groundPoint.y < -100 ||
            groundPoint.y > height + 100
          ) {
            continue;
          }

          const scale = Math.min(32, Math.max(14, 10 + zoom * 1.6));

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

          // In perspective view with pitch, altitude elevates target visually upwards on the screen
          const altElevationPx = Math.min(54, (effectiveAltM / 1000) * (zoom * 0.7));
          const airX = groundPoint.x;
          const airY = groundPoint.y - altElevationPx;

          // Geographically synchronized forward projection vector
          const futureSec = Math.max(15, Math.min(90, 450 / Math.max(1, zoom)));
          const futureGeo = destinationPoint({ lat, lon }, heading, speed * (elapsedSeconds + futureSec));
          const futureProj = map.project([futureGeo.lon, futureGeo.lat]);
          const futureAir = { x: futureProj.x, y: futureProj.y - altElevationPx };

          // Screen heading strictly matching the projected vector on camera
          const vDx = futureAir.x - airX;
          const vDy = futureAir.y - airY;
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
            ctx.arc(airX, airY, 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            continue;
          }

          // Draw ground footprint shadow & vertical altitude stem connecting terrain to airborne craft
          if (altElevationPx > 4) {
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(groundPoint.x, groundPoint.y, scale * 0.36, scale * 0.18, 0, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
            ctx.fill();
            ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
            ctx.lineWidth = 1;
            ctx.stroke();

            // Vertical dashed altitude stem
            ctx.beginPath();
            ctx.setLineDash([2, 3]);
            ctx.moveTo(groundPoint.x, groundPoint.y);
            ctx.lineTo(airX, airY);
            ctx.strokeStyle = "rgba(226, 232, 240, 0.35)";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
          }

          // Ultra-precise ground targeting reticle pinned directly to terrain nadir
          if (zoom >= 10.5) {
            drawGroundReticle(ctx, groundPoint.x, groundPoint.y, isHighThreat, now);
          }

          if (speed > 5) {
            drawUncertaintyCone(ctx, airX, airY, screenHeadingDeg, Math.min(100, Math.max(20, vDist * 1.2)));
          }

          if (type === "uav") {
            const pulseRadius = (Math.sin(now / 200) * 0.5 + 0.5) * 16 + 10;
            ctx.beginPath();
            ctx.arc(airX, airY, pulseRadius, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }

          if (type === "munition") {
            drawMissileFlame(ctx, airX, airY, screenHeadingDeg, now);
          }

          if (type === "uav") {
            drawUavSilhouette(ctx, airX, airY, scale, screenHeadingDeg, color, now);
          } else if (type === "munition") {
            drawMissileSilhouette(ctx, airX, airY, scale, screenHeadingDeg, color);
          } else if (type === "helicopter") {
            drawHelicopterSilhouette(ctx, airX, airY, scale, screenHeadingDeg, color, now);
          } else {
            drawAircraftSilhouette(ctx, airX, airY, scale, screenHeadingDeg, color, now);
          }

          // Geographically synchronized velocity vector
          if (speed > 5 && vDist > 2) {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(airX, airY);
            ctx.lineTo(futureAir.x, futureAir.y);
            ctx.stroke();
            ctx.restore();
          }

          // Target Tag & Telemetry with high-contrast outlines or High-Zoom Tactical Glass HUD Badge
          if (zoom >= 10.5 || (isSelected && zoom >= 8.5)) {
            const displayId = id.startsWith("adsb-") ? `FLIGHT ${id.slice(5).toUpperCase()}` : id.toUpperCase();
            const speedKmh = Math.round(speed * 3.6);
            const speedKnots = Math.round(speed * 1.94384);
            const altMsl = effectiveAltM >= 1000 ? `${(effectiveAltM / 1000).toFixed(1)} км` : `${Math.round(effectiveAltM)} м`;
            const altFt = Math.round(effectiveAltM * 3.28084);
            const landmark = findNearestLandmark(predicted.lat, predicted.lon);
            drawTacticalGlassBadge(
              ctx,
              airX,
              airY,
              displayId,
              speedKmh,
              speedKnots,
              altMsl,
              altFt,
              heading,
              landmark,
              isHighThreat
            );
          } else if (zoom >= 5.5 || isSelected || isHighThreat) {
            const displayId = id.startsWith("adsb-") ? `FLIGHT ${id.slice(5).toUpperCase()}` : id.toUpperCase();
            const speedText = `${Math.round(speed * 3.6)} км/год`;
            const altLabel = effectiveAltM >= 1000 ? `${(effectiveAltM / 1000).toFixed(1)} км` : `${Math.round(effectiveAltM)} м`;
            drawTextWithOutline(ctx, displayId, airX + 14, airY - 8, "#f8fafc");
            if (zoom >= 7.0 || isSelected) {
              drawTextWithOutline(
                ctx,
                `${speedText} • H:${altLabel}`,
                airX + 14,
                airY + 6,
                "rgba(226, 232, 240, 0.85)",
                "rgba(0, 0, 0, 0.85)",
                "10px monospace"
              );
            }
          }

          // Selected target Lock Reticle & 15-minute Intercept Vector
          if (currentSelected && currentSelected[0] === id) {
            drawLockReticle(ctx, airX, airY, (now / 40) % 360);

            if (speed > 5) {
              ctx.save();
              ctx.setLineDash([5, 5]);
              ctx.strokeStyle = "#38bdf8";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(airX, airY);

              const waypoints = [300, 600, 900];
              const wpCoords: Array<{ x: number; y: number; min: number }> = [];

              for (const sec of waypoints) {
                const wpGeo = destinationPoint({ lat, lon }, heading, speed * (elapsedSeconds + sec));
                const wpProj = map.project([wpGeo.lon, wpGeo.lat]);
                ctx.lineTo(wpProj.x, wpProj.y - altElevationPx);
                wpCoords.push({ x: wpProj.x, y: wpProj.y - altElevationPx, min: sec / 60 });
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
    </div>
  );
};
