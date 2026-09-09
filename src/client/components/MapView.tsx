import { useEffect, useRef } from "react";
import maplibregl, { type Map } from "maplibre-gl";
import type { TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { destinationPoint, haversineMeters } from "../lib/geo";
import { soundEngine } from "../lib/sound";
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
  onMapReady?: (map: Map) => void;
  onSelectTarget?: (packet: TrackPacket) => void;
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
  color: string
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);

  // Shahed delta wing
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.85);
  ctx.lineTo(size * 0.65, size * 0.45);
  ctx.lineTo(size * 0.65, size * 0.6);
  ctx.lineTo(size * 0.18, size * 0.4);
  ctx.lineTo(0, size * 0.55);
  ctx.lineTo(-size * 0.18, size * 0.4);
  ctx.lineTo(-size * 0.65, size * 0.6);
  ctx.lineTo(-size * 0.65, size * 0.45);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Winglet markers
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-size * 0.65, size * 0.4, 2, 4);
  ctx.fillRect(size * 0.65 - 2, size * 0.4, 2, 4);

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

  // Cruise missile body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.95);
  ctx.lineTo(size * 0.22, -size * 0.35);
  ctx.lineTo(size * 0.55, -size * 0.05);
  ctx.lineTo(size * 0.22, 0);
  ctx.lineTo(size * 0.22, size * 0.5);
  ctx.lineTo(size * 0.4, size * 0.65);
  ctx.lineTo(size * 0.15, size * 0.65);
  ctx.lineTo(0, size * 0.62);
  ctx.lineTo(-size * 0.15, size * 0.65);
  ctx.lineTo(-size * 0.4, size * 0.65);
  ctx.lineTo(-size * 0.22, size * 0.5);
  ctx.lineTo(-size * 0.22, 0);
  ctx.lineTo(-size * 0.55, -size * 0.05);
  ctx.lineTo(-size * 0.22, -size * 0.35);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.restore();
};

const drawAircraftSilhouette = (
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

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.9);
  ctx.lineTo(size * 0.15, -size * 0.3);
  ctx.lineTo(size * 0.8, size * 0.25);
  ctx.lineTo(size * 0.8, size * 0.35);
  ctx.lineTo(size * 0.18, size * 0.2);
  ctx.lineTo(size * 0.18, size * 0.6);
  ctx.lineTo(size * 0.4, size * 0.8);
  ctx.lineTo(size * 0.4, size * 0.88);
  ctx.lineTo(0, size * 0.75);
  ctx.lineTo(-size * 0.4, size * 0.88);
  ctx.lineTo(-size * 0.4, size * 0.8);
  ctx.lineTo(-size * 0.18, size * 0.6);
  ctx.lineTo(-size * 0.18, size * 0.2);
  ctx.lineTo(-size * 0.8, size * 0.35);
  ctx.lineTo(-size * 0.8, size * 0.25);
  ctx.lineTo(-size * 0.15, -size * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

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

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.1, size * 0.3, size * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, size * 0.45);
  ctx.lineTo(0, size * 0.95);
  ctx.lineTo(size * 0.25, size * 0.95);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const rotorAngle = (timeMs / 18) % 360;
  ctx.save();
  ctx.translate(0, -size * 0.1);
  ctx.rotate((rotorAngle * Math.PI) / 180);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.9);
  ctx.lineTo(0, size * 0.9);
  ctx.moveTo(-size * 0.9, 0);
  ctx.lineTo(size * 0.9, 0);
  ctx.stroke();
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

export const MapView = ({
  packets,
  mapStyleUrl,
  location,
  filters,
  visionMode = "satellite",
  selectedTarget,
  onMapReady,
  onSelectTarget
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

  const onSelectTargetRef = useRef(onSelectTarget);
  onSelectTargetRef.current = onSelectTarget;

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
      pitch: 52, // 3D orbital perspective
      bearing: -10,
      maxPitch: 82,
      antialias: true,
      attributionControl: false
    });

    mapRef.current = map;
    onMapReadyRef.current?.(map);

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      if (!onSelectTargetRef.current) return;

      const clickX = e.point.x;
      const clickY = e.point.y;

      let closest: TrackPacket | null = null;
      let minDistance = 38;

      for (const packet of packetsRef.current) {
        const [, , lat, lon, heading, speed, timestamp] = packet;
        const elapsedSeconds = Math.max(0, (Date.now() - timestamp) / 1000);
        const predicted = destinationPoint({ lat, lon }, heading, speed * elapsedSeconds);
        const projected = map.project([predicted.lon, predicted.lat]);

        const dist = Math.hypot(projected.x - clickX, projected.y - clickY);
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

        // 0. Radar Beam Sweep Scan (continuous 360 deg sweep)
        const sweepPeriod = 5000;
        const sweepAngle = ((now % sweepPeriod) / sweepPeriod) * Math.PI * 2;
        const sweepOrigin = currentLoc
          ? map.project([currentLoc.lon, currentLoc.lat])
          : { x: width / 2, y: height / 2 };
        const sweepRadius = Math.max(100, Math.max(width, height) * 1.1);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sweepOrigin.x, sweepOrigin.y);
        ctx.arc(sweepOrigin.x, sweepOrigin.y, sweepRadius, sweepAngle - 0.35, sweepAngle);
        ctx.closePath();

        const sweepGrad = ctx.createRadialGradient(
          sweepOrigin.x,
          sweepOrigin.y,
          0,
          sweepOrigin.x,
          sweepOrigin.y,
          sweepRadius
        );
        sweepGrad.addColorStop(0, "rgba(56, 189, 248, 0.18)");
        sweepGrad.addColorStop(0.7, "rgba(56, 189, 248, 0.04)");
        sweepGrad.addColorStop(1, "rgba(56, 189, 248, 0)");
        ctx.fillStyle = sweepGrad;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(sweepOrigin.x, sweepOrigin.y);
        ctx.lineTo(
          sweepOrigin.x + Math.cos(sweepAngle) * sweepRadius,
          sweepOrigin.y + Math.sin(sweepAngle) * sweepRadius
        );
        ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // 1. Draw Range Rings around user
        if (currentLoc) {
          const userPoint = map.project([currentLoc.lon, currentLoc.lat]);
          const mPerPx = metersPerPixel(currentLoc.lat, zoom);

          const rings = [15_000, 30_000, 50_000];
          ctx.save();
          for (const radiusM of rings) {
            const radiusPx = radiusM / mPerPx;
            ctx.beginPath();
            ctx.arc(userPoint.x, userPoint.y, radiusPx, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(59, 130, 246, 0.28)";
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.stroke();

            drawTextWithOutline(
              ctx,
              `${radiusM / 1000} км`,
              userPoint.x + radiusPx + 4,
              userPoint.y,
              "rgba(147, 197, 253, 0.85)",
              "rgba(0, 0, 0, 0.8)",
              "10px Inter, monospace"
            );
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
          const [id, type, lat, lon, heading, speed, timestamp] = packet;

          if (currentFilters) {
            if (type === "uav" && !currentFilters.uav) continue;
            if (type === "munition" && !currentFilters.munition) continue;
            if ((type === "aircraft" || type === "helicopter") && !currentFilters.aircraft) continue;
          }

          const elapsedSeconds = Math.max(0, (now - timestamp) / 1000);
          const predicted = destinationPoint({ lat, lon }, heading, speed * elapsedSeconds);
          const projected = map.project([predicted.lon, predicted.lat]);

          if (
            projected.x < -100 ||
            projected.x > width + 100 ||
            projected.y < -100 ||
            projected.y > height + 100
          ) {
            continue;
          }

          const scale = Math.max(22, 12 + zoom * 1.5);
          const metersPx = Math.max(metersPerPixel(predicted.lat, zoom), 0.1);
          const velocityLine = Math.max(25, Math.min(180, (speed * 12) / metersPx));

          if (speed > 5) {
            drawUncertaintyCone(ctx, projected.x, projected.y, heading, velocityLine * 1.8);
          }

          if (type === "uav") {
            const pulseRadius = (Math.sin(now / 200) * 0.5 + 0.5) * 16 + 10;
            ctx.beginPath();
            ctx.arc(projected.x, projected.y, pulseRadius, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }

          if (type === "munition") {
            drawMissileFlame(ctx, projected.x, projected.y, heading, now);
          }

          let color = "#7dd3fc";
          if (type === "uav") color = "#ef4444";
          if (type === "munition") color = "#f97316";
          if (type === "helicopter") color = "#10b981";
          if (type === "thermal") color = "#eab308";

          if (type === "uav") {
            drawUavSilhouette(ctx, projected.x, projected.y, scale, heading, color);
          } else if (type === "munition") {
            drawMissileSilhouette(ctx, projected.x, projected.y, scale, heading, color);
          } else if (type === "helicopter") {
            drawHelicopterSilhouette(ctx, projected.x, projected.y, scale, heading, color, now);
          } else {
            drawAircraftSilhouette(ctx, projected.x, projected.y, scale, heading, color);
          }

          // Velocity vector
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(projected.x, projected.y);
          ctx.lineTo(
            projected.x + Math.sin((heading * Math.PI) / 180) * velocityLine,
            projected.y - Math.cos((heading * Math.PI) / 180) * velocityLine
          );
          ctx.stroke();
          ctx.restore();

          // Target Tag & Telemetry with high-contrast outlines
          const displayId = id.startsWith("adsb-") ? `FLIGHT ${id.slice(5).toUpperCase()}` : id.toUpperCase();
          const speedText = `${Math.round(speed * 3.6)} км/год`;
          drawTextWithOutline(ctx, displayId, projected.x + 14, projected.y - 8, "#f8fafc");
          drawTextWithOutline(
            ctx,
            speedText,
            projected.x + 14,
            projected.y + 6,
            "rgba(226, 232, 240, 0.85)",
            "rgba(0, 0, 0, 0.85)",
            "10px monospace"
          );

          // Selected target Lock Reticle & 15-minute Intercept Vector
          if (currentSelected && currentSelected[0] === id) {
            drawLockReticle(ctx, projected.x, projected.y, (now / 40) % 360);

            if (speed > 5) {
              ctx.save();
              ctx.setLineDash([5, 5]);
              ctx.strokeStyle = "#38bdf8";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(projected.x, projected.y);

              const waypoints = [300, 600, 900];
              const wpCoords: Array<{ x: number; y: number; min: number }> = [];

              for (const sec of waypoints) {
                const wpGeo = destinationPoint({ lat, lon }, heading, speed * (elapsedSeconds + sec));
                const wpProj = map.project([wpGeo.lon, wpGeo.lat]);
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
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <div className={`map-shell map-view-container vision-${visionMode}`}>
      <div ref={mapContainerRef} className="map-root" />
      <canvas ref={canvasRef} className="map-overlay" />
      <div className="space-vignette" />
    </div>
  );
};
