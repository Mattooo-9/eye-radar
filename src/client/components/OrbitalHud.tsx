import { useEffect, useState } from "react";
import type { Map } from "maplibre-gl";

interface OrbitalHudProps {
  map: Map | null;
  trackCount: number;
  onOpenBriefing?: () => void;
}

export const OrbitalHud = ({ map, trackCount, onOpenBriefing }: OrbitalHudProps) => {
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
        <button
          className="hud-status-badge"
          onClick={onOpenBriefing}
          title="Натисніть для тактичного AI-зведення"
          style={{ cursor: "pointer", border: "1px solid rgba(56,189,248,0.5)" }}
        >
          {trackCount > 0 ? `🚨 ${trackCount} ЦІЛЕЙ (AI)` : "🟢 СЕКТОР ЧИСТИЙ (AI)"}
        </button>
      </div>
    </div>
  );
};
