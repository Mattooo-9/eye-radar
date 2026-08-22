import { useEffect, useRef } from "react";
import maplibregl, { type Map } from "maplibre-gl";
import type { TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { destinationPoint } from "../lib/geo";

interface MapViewProps {
  packets: TrackPacket[];
  mapStyleUrl: string;
  location: TrustedLocation | null;
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
  ctx.restore();
};

export const MapView = ({ packets, mapStyleUrl, location }: MapViewProps) => {
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
      center: [30.5234, 50.4501],
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

    map.on("load", resizeCanvas);
    map.on("resize", resizeCanvas);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      map.remove();
      mapRef.current = null;
    };
  }, [mapStyleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !location || centeredRef.current) {
      return;
    }

    map.jumpTo({
      center: [location.lon, location.lat],
      zoom: 10
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

        for (const packet of packets) {
          const [id, type, lat, lon, heading, speed, timestamp] = packet;
          const elapsedSeconds = Math.max(0, (Date.now() - timestamp) / 1000);
          const predicted = destinationPoint({ lat, lon }, heading, speed * elapsedSeconds);
          const projected = map.project([predicted.lon, predicted.lat]);
          const scale = Math.max(24, 14 + zoom * 1.3);
          const metersPx = Math.max(metersPerPixel(predicted.lat, zoom), 0.1);
          const velocityLine = Math.max(20, Math.min(140, (speed * 8) / metersPx));

          if (
            projected.x < -200 ||
            projected.x > width + 200 ||
            projected.y < -200 ||
            projected.y > height + 200
          ) {
            continue;
          }

          drawArrow(
            ctx,
            projected.x,
            projected.y,
            scale,
            heading,
            type === "uav" ? "#ff7b72" : "#7dd3fc"
          );

          ctx.strokeStyle = "rgba(125, 211, 252, 0.9)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(projected.x, projected.y);
          ctx.lineTo(
            projected.x + Math.sin((heading * Math.PI) / 180) * velocityLine,
            projected.y - Math.cos((heading * Math.PI) / 180) * velocityLine
          );
          ctx.stroke();

          ctx.fillStyle = "#e2e8f0";
          ctx.font = "12px Inter, system-ui, sans-serif";
          ctx.fillText(id, projected.x + 12, projected.y - 12);
        }

        if (location) {
          const userPoint = map.project([location.lon, location.lat]);
          ctx.beginPath();
          ctx.fillStyle = "#22c55e";
          ctx.arc(userPoint.x, userPoint.y, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(34, 197, 94, 0.25)";
          ctx.lineWidth = 10;
          ctx.stroke();
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
      <canvas ref={canvasRef} className="map-overlay" />
    </div>
  );
};
