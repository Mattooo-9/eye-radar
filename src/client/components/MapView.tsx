import { useEffect, useRef } from "react";
import maplibregl, { type Map } from "maplibre-gl";
import type { TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { destinationPoint, haversineMeters } from "../lib/geo";
import { soundEngine } from "../lib/sound";
import type { FilterState } from "./StatusPanel";

interface MapViewProps {
  packets: TrackPacket[];
  mapStyleUrl: string;
  location: TrustedLocation | null;
  filters?: FilterState;
  onSelectTarget?: (packet: TrackPacket) => void;
}

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
  ctx.moveTo(0, -size * 0.72);
  ctx.lineTo(size * 0.48, size * 0.56);
  ctx.lineTo(0, size * 0.24);
  ctx.lineTo(-size * 0.48, size * 0.56);
  ctx.closePath();
  ctx.fill();

  // Subtle border
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
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
  spreadAngleDeg = 25
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

  ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
  ctx.fill();
  ctx.strokeStyle = "rgba(239, 68, 68, 0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.restore();
};

export const MapView = ({ packets, mapStyleUrl, location, filters, onSelectTarget }: MapViewProps) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const frameRef = useRef<number | null>(null);
  const centeredRef = useRef(false);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: mapStyleUrl,
      center: [31.5, 49.0], // Center of Ukraine
      zoom: 6,
      antialias: true,
      attributionControl: false
    });

    mapRef.current = map;

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
      let minDistance = 32; // Click hit radius in px

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

    map.on("click", handleMapClick);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      map.off("click", handleMapClick);
      map.remove();
      mapRef.current = null;
    };
  }, [mapStyleUrl, onSelectTarget, packets]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !location || centeredRef.current) {
      return;
    }

    map.jumpTo({
      center: [location.lon, location.lat],
      zoom: 8
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

        const zoom = map.getZoom();

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
            ctx.strokeStyle = "rgba(59, 130, 246, 0.22)";
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 6]);
            ctx.stroke();

            // Label
            ctx.fillStyle = "rgba(147, 197, 253, 0.7)";
            ctx.font = "10px Inter, sans-serif";
            ctx.fillText(`${radiusM / 1000} км`, userPoint.x + radiusPx + 4, userPoint.y);
          }
          ctx.restore();

          // User Marker
          ctx.beginPath();
          ctx.fillStyle = "#22c55e";
          ctx.arc(userPoint.x, userPoint.y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(34, 197, 94, 0.35)";
          ctx.lineWidth = 8;
          ctx.stroke();
        }

        // 2. Draw Air Targets
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

          const elapsedSeconds = Math.max(0, (Date.now() - timestamp) / 1000);
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

          // Target Tag
          ctx.fillStyle = "#f8fafc";
          ctx.font = "bold 11px Inter, system-ui, sans-serif";
          ctx.fillText(id, projected.x + 14, projected.y - 8);

          ctx.fillStyle = "rgba(226, 232, 240, 0.75)";
          ctx.font = "10px Inter, system-ui, sans-serif";
          ctx.fillText(`${Math.round(speed * 3.6)} км/год`, projected.x + 14, projected.y + 6);
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
  }, [location, packets]);

  return (
    <div className="map-shell">
      <div ref={mapContainerRef} className="map-root" />
      <canvas
        ref={canvasRef}
        className="map-overlay"
      />
    </div>
  );
};
