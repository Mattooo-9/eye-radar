import { useEffect, useState } from "react";
import type { Map } from "maplibre-gl";

interface OrbitalHudProps {
  map: Map | null;
  trackCount: number;
  onOpenBriefing?: () => void;
}

export const OrbitalHud = ({ map, trackCount, onOpenBriefing }: OrbitalHudProps) => {
  const [coords, setCoords] = useState({ lat: 49.0, lon: 31.5 });
  const [bearing, setBearing] = useState(0);
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

  const [isOpenTelemetry, setIsOpenTelemetry] = useState(false);
  const utcTimeStr = nowDate.toISOString().slice(11, 19) + " UTC";

  return (
    <div className="orbital-hud">
      <div
        className="orbital-hud-left"
        onClick={() => {
          window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
          setIsOpenTelemetry((prev) => !prev);
        }}
        style={{ cursor: "pointer" }}
        title="Натисніть для орбітальної телеметрії та діагностики"
      >
        <img
          src="/avatar.jpg"
          alt="Eye Radar Logo"
          className="hud-emblem"
        />
        <div>
          <span className="hud-label">EYE RADAR // ORBITAL DEFENSE ▼</span>
          <span className="hud-sub">
            {utcTimeStr} • 5 ДЖЕРЕЛ (РАДАРИ + СУПУТНИКИ + ADS-B)
          </span>
        </div>
      </div>

      <div
        className="orbital-hud-center"
        onClick={() => {
          window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
          setIsOpenTelemetry((prev) => !prev);
        }}
        style={{ cursor: "pointer" }}
        title="Координати та курс спостереження"
      >
        <span className="hud-coords">
          {coords.lat.toFixed(2)}°N / {coords.lon.toFixed(2)}°E
        </span>
        <span className="hud-bearing">
          🧭 {normBearing}° {getCompassDir(normBearing)}
        </span>
      </div>

      <div className="orbital-hud-right">
        <button
          className="hud-status-badge"
          onClick={() => {
            window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
            onOpenBriefing?.();
          }}
          title="Натисніть для тактичного AI-зведення"
          style={{ cursor: "pointer", border: "1px solid rgba(56,189,248,0.5)" }}
        >
          {trackCount > 0 ? `🚨 ${trackCount} ЦІЛЕЙ (AI) ▼` : "🟢 СЕКТОР ЧИСТИЙ (AI) ▼"}
        </button>
      </div>

      {isOpenTelemetry && (
        <div className="orbital-telemetry-popover">
          <div className="popover-header">
            <div className="popover-title">
              <span className="popover-icon">🛰️</span>
              <strong>ОРБІТАЛЬНИЙ КОМПЛЕКС СПОСТЕРЕЖЕННЯ</strong>
            </div>
            <button
              type="button"
              className="popover-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                setIsOpenTelemetry(false);
              }}
            >
              ✕
            </button>
          </div>

          <div className="popover-body">
            <div className="source-row">
              <span className="source-label">Орбітальна висота / Спостереження</span>
              <span className="source-badge online">ALT: 480 KM • INC: 51.6°</span>
            </div>
            <div className="source-row">
              <span className="source-label">Сенсорне слияння (Fusion)</span>
              <span className="source-badge online">5 Джерел (Радари + NASA + ADS-B)</span>
            </div>
            <div className="source-row">
              <span className="source-label">Центр огляду камери</span>
              <code className="coords-code">
                {coords.lat.toFixed(4)}°N, {coords.lon.toFixed(4)}°E • CRS: {normBearing}°
              </code>
            </div>
            <div className="source-row">
              <span className="source-label">Точний час театру дій</span>
              <span className="source-badge online">{utcTimeStr} (Київ: UTC+3)</span>
            </div>
          </div>

          <div className="popover-footer">
            <button
              type="button"
              className="popover-action-btn"
              onClick={() => {
                setIsOpenTelemetry(false);
                onOpenBriefing?.();
              }}
            >
              📋 Відкрити аналітичний AI-брифінг
            </button>
            {map && (
              <button
                type="button"
                className="popover-action-btn secondary"
                onClick={() => {
                  setIsOpenTelemetry(false);
                  map.flyTo({ center: [31.5, 49.0], zoom: 6.2, duration: 1200 });
                }}
              >
                🇺🇦 Скинути фокус на всю Україну
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
