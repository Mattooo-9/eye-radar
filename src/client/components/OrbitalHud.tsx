import { useEffect, useMemo, useState } from "react";
import type { Map } from "maplibre-gl";
import { getLocalSolarStatus } from "../lib/solarTerminator";

interface OrbitalHudProps {
  map: Map | null;
  trackCount: number;
  onOpenBriefing?: () => void;
}

export const OrbitalHud = ({ map, trackCount, onOpenBriefing }: OrbitalHudProps) => {
  const [coords, setCoords] = useState({ lat: 49.0, lon: 31.5 });
  const [bearing, setBearing] = useState(-10);
  const [nowDate, setNowDate] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNowDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const center = map.getCenter();
      setCoords({ lat: center.lat, lon: center.lng });
      setBearing(Math.round(map.getBearing()));
    };

    map.on("move", update);
    map.on("rotate", update);
    return () => {
      map.off("move", update);
      map.off("rotate", update);
    };
  }, [map]);

  const solarStatus = useMemo(
    () => getLocalSolarStatus(coords.lat, coords.lon, nowDate),
    [coords.lat, coords.lon, nowDate]
  );

  const normBearing = ((bearing % 360) + 360) % 360;
  const getCompassDir = (b: number) => {
    if (b >= 337.5 || b < 22.5) return "N";
    if (b >= 22.5 && b < 67.5) return "NE";
    if (b >= 67.5 && b < 112.5) return "E";
    if (b >= 112.5 && b < 157.5) return "SE";
    if (b >= 157.5 && b < 202.5) return "S";
    if (b >= 202.5 && b < 247.5) return "SW";
    if (b >= 247.5 && b < 292.5) return "W";
    return "NW";
  };

  const utcTimeStr = nowDate.toISOString().slice(11, 19) + " UTC";

  return (
    <div className="orbital-hud">
      <div className="orbital-hud-left">
        <img
          src="/avatar.jpg"
          alt="Eye Radar Logo"
          className="hud-emblem"
          onClick={onOpenBriefing}
          title="Eye Radar Space Defense Reconnaissance"
        />
        <div>
          <span className="hud-label">EYE RADAR // ORBITAL DEFENSE</span>
          <span className="hud-sub">
            {utcTimeStr} • ALT: 480 KM • INC: 51.6°
          </span>
        </div>
      </div>
      <div className="orbital-hud-center">
        <span className="hud-coords">
          {coords.lat.toFixed(2)}°N / {coords.lon.toFixed(2)}°E
        </span>
        <span className="hud-bearing">
          🧭 {normBearing}° {getCompassDir(normBearing)}
        </span>
        <span
          className="hud-solar-pill"
          title={`Висота сонця: ${solarStatus.elevationDeg.toFixed(1)}°`}
        >
          {solarStatus.phaseIcon} {solarStatus.phaseTitle} ({solarStatus.elevationDeg > 0 ? "+" : ""}
          {solarStatus.elevationDeg.toFixed(0)}°)
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
