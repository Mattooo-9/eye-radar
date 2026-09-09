import { useEffect, useState } from "react";
import type { Map } from "maplibre-gl";

interface OrbitalHudProps {
  map: Map | null;
  trackCount: number;
}

export const OrbitalHud = ({ map, trackCount }: OrbitalHudProps) => {
  const [coords, setCoords] = useState({ lat: 49.0, lon: 31.5 });

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const center = map.getCenter();
      setCoords({ lat: center.lat, lon: center.lng });
    };

    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [map]);

  return (
    <div className="orbital-hud">
      <div className="orbital-hud-left">
        <span className="hud-label">SAT-ORBIT // RECON PROTOCOL</span>
        <span className="hud-sub">ALT: 480 KM • INC: 51.6° • FUSION: ACTIVE</span>
      </div>
      <div className="orbital-hud-center">
        <span className="hud-coords">
          {coords.lat.toFixed(2)}°N / {coords.lon.toFixed(2)}°E
        </span>
      </div>
      <div className="orbital-hud-right">
        <span className="hud-status-badge">
          {trackCount > 0 ? `🚨 ${trackCount} ЦІЛЕЙ У НЕБІ` : "🟢 СЕКТОР ЧИСТИЙ"}
        </span>
      </div>
    </div>
  );
};
