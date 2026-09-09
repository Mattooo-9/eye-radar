import { useEffect, useRef, useState } from "react";
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
        "raster-brightness-max": 0.82,
        "raster-contrast": 0.25
      }
    }
  ]
};

const metersPerPixel = (latitude: number, zoom: number): number =>
  (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;

const drawArrow = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number,
  fillStyle: string
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.75);
  ctx.lineTo(size * 0.5, size * 0.55);
  ctx.lineTo(0, size * 0.22);
  ctx.lineTo(-size * 0.5, size * 0.55);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
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

  ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
  ctx.fill();
  ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
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

  const size = 26;
  const bracket = 8;
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;

  // Top-left bracket
  ctx.beginPath();
  ctx.moveTo(-size, -size + bracket);
  ctx.lineTo(-size, -size);
  ctx.lineTo(-size + bracket, -size);
  ctx.stroke();

  // Top-right bracket
  ctx.beginPath();
  ctx.moveTo(size - bracket, -size);
  ctx.lineTo(size, -size);
  ctx.lineTo(size, -size + bracket);
  ctx.stroke();

  // Bottom-right bracket
  ctx.beginPath();
  ctx.moveTo(size, size - bracket);
  ctx.lineTo(size, size);
  ctx.lineTo(size - bracket, size);
  ctx.stroke();

  // Bottom-left bracket
  ctx.beginPath();
  ctx.moveTo(-size + bracket, size);
  ctx.lineTo(-size, size);
  ctx.lineTo(-size, size - bracket);
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

  const flicker = (Math.sin(timeMs / 35) * 0.5 + 0.5) * 6;
  const flameLen = 16 + flicker;

  const grad = ctx.createLinearGradient(0, 0, 0, flameLen);
  grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  grad.addColorStop(0.3, "rgba(251, 146, 60, 0.9)");
  grad.addColorStop(1, "rgba(239, 68, 68, 0)");

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-3, 0);
  ctx.lineTo(0, flameLen);
  ctx.lineTo(3, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

export const MapView = ({
  packets,
  mapStyleUrl,
  location,
  filters,
  satelliteMode,
  visionMode = "satellite",
  selectedTarget,
  onMapReady,
  onSelectTarget
}: MapViewProps) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const frameRef = useRef<number | null>(null);
  const centeredRef = useRef(false);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const useSatellite = visionMode !== "tactical";
    const initialStyle = useSatellite ? SATELLITE_STYLE : mapStyleUrl;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: initialStyle,
      center: [31.5, 49.0], // Center of Ukraine
      zoom: 6.2,
      pitch: 52, // 3D orbital angle from space
      bearing: -10, // Slight orbital inclination
      maxPitch: 82,
      antialias: true,
      attributionControl: false
    });

    mapRef.current = map;
    if (onMapReady) {
      onMapReady(map);
    }

    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      const container = mapContainerRef.current;
      if (!canvas || !container) {
        return;
      }

      const ratio = window.devicePixelRatio || 1;
      canvas.width = container.clientWidth * ratio;
      canvas.height = container.clientHeight * ratio;
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      if (!onSelectTarget) return;

      const clickX = e.point.x;
      const clickY = e.point.y;

      let closest: TrackPacket | null = null;
      let minDistance = 36;

      for (const packet of packets) {
        const [_id, _type, lat, lon, heading, speed, timestamp] = packet;
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
        onSelectTarget(closest);
      }
    };

    map.on("load", resizeCanvas);
    map.on("resize", resizeCanvas);
    map.on("click", handleMapClick);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      map.off("click", handleMapClick);
      map.remove();
      mapRef.current = null;
    };
  }, [mapStyleUrl, onMapReady, onSelectTarget, packets, visionMode]);

  // Handle Vision Mode / Tactical switch
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const isSat = visionMode !== "tactical";
    map.setStyle(isSat ? SATELLITE_STYLE : mapStyleUrl);
  }, [mapStyleUrl, visionMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !location || centeredRef.current) {
      return;
    }

    map.flyTo({
      center: [location.lon, location.lat],
      zoom: 8.5,
      pitch: 55,
      duration: 1500
    });
    centeredRef.current = true;
  }, [location]);

  useEffect(() => {
    const render = () => {
      const map = mapRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");

      if (map && canvas && ctx) {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        ctx.clearRect(0, 0, width, height);

        const now = Date.now();
        const zoom = map.getZoom();

        // 0. Radar Beam Sweep Scan Line (360 deg)
        const sweepPeriod = 5500;
        const sweepAngle = ((now % sweepPeriod) / sweepPeriod) * Math.PI * 2;
        const sweepOrigin = location ? map.project([location.lon, location.lat]) : { x: width / 2, y: height / 2 };
        const sweepRadius = Math.max(width, height) * 0.95;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(sweepOrigin.x, sweepOrigin.y);
        ctx.arc(sweepOrigin.x, sweepOrigin.y, sweepRadius, sweepAngle - 0.35, sweepAngle);
        ctx.closePath();

        const sweepGrad = ctx.createRadialGradient(sweepOrigin.x, sweepOrigin.y, 0, sweepOrigin.x, sweepOrigin.y, sweepRadius);
        sweepGrad.addColorStop(0, "rgba(56, 189, 248, 0.16)");
        sweepGrad.addColorStop(0.7, "rgba(56, 189, 248, 0.04)");
        sweepGrad.addColorStop(1, "rgba(56, 189, 248, 0)");
        ctx.fillStyle = sweepGrad;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(sweepOrigin.x, sweepOrigin.y);
        ctx.lineTo(sweepOrigin.x + Math.cos(sweepAngle) * sweepRadius, sweepOrigin.y + Math.sin(sweepAngle) * sweepRadius);
        ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // 1. Draw Range Rings around user
        if (location) {
          const userPoint = map.project([location.lon, location.lat]);
          const mPerPx = metersPerPixel(location.lat, zoom);

          const rings = [15_000, 30_000, 50_000];
          ctx.save();
          for (const radiusM of rings) {
            const radiusPx = radiusM / mPerPx;
            ctx.beginPath();
            ctx.arc(userPoint.x, userPoint.y, radiusPx, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(59, 130, 246, 0.25)";
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.stroke();

            ctx.fillStyle = "rgba(147, 197, 253, 0.75)";
            ctx.font = "10px Inter, sans-serif";
            ctx.fillText(`${radiusM / 1000} км`, userPoint.x + radiusPx + 4, userPoint.y);
          }
          ctx.restore();

          // User Marker with pulse
          const userPulse = Math.sin(now / 300) * 3 + 7;
          ctx.beginPath();
          ctx.fillStyle = "#22c55e";
          ctx.arc(userPoint.x, userPoint.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(34, 197, 94, 0.3)";
          ctx.lineWidth = userPulse;
          ctx.stroke();
        }

        // 2. Draw Air Targets with 3D projection and Orbital Shading
        for (const packet of packets) {
          const [id, type, lat, lon, heading, speed, timestamp] = packet;

          // Layer filters
          if (filters) {
            if (type === "uav" && !filters.uav) continue;
            if (type === "munition" && !filters.munition) continue;
            if ((type === "aircraft" || type === "helicopter") && !filters.aircraft) continue;
          }

          // Tactical audio ping if threat is within 25km
          if (location && (type === "uav" || type === "munition")) {
            const dist = haversineMeters({ lat, lon }, { lat: location.lat, lon: location.lon });
            if (dist <= 25_000 && filters?.sound !== false) {
              soundEngine.playRadarPing();
            }
          }

          const elapsedSeconds = Math.max(0, (now - timestamp) / 1000);
          const predicted = destinationPoint({ lat, lon }, heading, speed * elapsedSeconds);
          const projected = map.project([predicted.lon, predicted.lat]);
          const scale = Math.max(22, 12 + zoom * 1.5);
          const metersPx = Math.max(metersPerPixel(predicted.lat, zoom), 0.1);
          const velocityLine = Math.max(25, Math.min(180, (speed * 12) / metersPx));

          if (
            projected.x < -100 ||
            projected.x > width + 100 ||
            projected.y < -100 ||
            projected.y > height + 100
          ) {
            continue;
          }

          // Draw uncertainty cone along the heading
          if (speed > 5) {
            drawUncertaintyCone(ctx, projected.x, projected.y, heading, velocityLine * 1.8);
          }

          // Drone Infrared Pulsing Beacon
          if (type === "uav") {
            const pulseRadius = (Math.sin(now / 200) * 0.5 + 0.5) * 14 + 10;
            ctx.beginPath();
            ctx.arc(projected.x, projected.y, pulseRadius, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(239, 68, 68, 0.35)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }

          // Missile Jet Exhaust Flame
          if (type === "munition") {
            drawMissileFlame(ctx, projected.x, projected.y, heading, now);
          }

          // Target color
          let color = "#7dd3fc"; // aircraft
          if (type === "uav") color = "#ef4444"; // bright red
          if (type === "munition") color = "#f97316"; // fiery orange
          if (type === "helicopter") color = "#10b981"; // emerald
          if (type === "thermal") color = "#eab308"; // yellow

          drawArrow(ctx, projected.x, projected.y, scale, heading, color);

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

          // Target Tag & Telemetry
          ctx.fillStyle = "#f8fafc";
          ctx.font = "bold 11px Inter, system-ui, sans-serif";
          ctx.fillText(id, projected.x + 14, projected.y - 8);

          ctx.fillStyle = "rgba(226, 232, 240, 0.75)";
          ctx.font = "10px Inter, system-ui, sans-serif";
          ctx.fillText(`${Math.round(speed * 3.6)} км/год`, projected.x + 14, projected.y + 6);

          // Selected target Lock Reticle & 15-minute Intercept Vector
          if (selectedTarget && selectedTarget[0] === id) {
            drawLockReticle(ctx, projected.x, projected.y, (now / 40) % 360);

            if (speed > 5) {
              ctx.save();
              ctx.setLineDash([5, 5]);
              ctx.strokeStyle = "#38bdf8";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(projected.x, projected.y);

              const waypoints = [300, 600, 900]; // 5, 10, 15 minutes
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
                ctx.fillStyle = "rgba(224, 242, 254, 0.95)";
                ctx.font = "bold 10px monospace";
                ctx.fillText(`+${wp.min}хв`, wp.x + 6, wp.y + 3);
              }
            }
          }
        }
      }

      frameRef.current = requestAnimationFrame(render);
    };

    frameRef.current = requestAnimationFrame(render);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [filters, location, packets, selectedTarget]);

  return (
    <div className={`map-shell map-view-container vision-${visionMode}`}>
      <div ref={mapContainerRef} className="map-root" />
      <canvas ref={canvasRef} className="map-overlay" />
      <div className="space-vignette" />
    </div>
  );
};
