import { useState } from "react";
import type { Map } from "maplibre-gl";
import type { VisionMode } from "./MapView";

interface OrbitalControlsProps {
  map: Map | null;
  visionMode: VisionMode;
  showDayNight?: boolean;
  onToggleDayNight?: () => void;
  showWeather?: boolean;
  onToggleWeather?: () => void;
  onCycleVision: () => void;
  onFlyToUser: () => void;
  onOpenParams: () => void;
}

export const OrbitalControls = ({
  map,
  visionMode,
  showDayNight = true,
  onToggleDayNight,
  showWeather = true,
  onToggleWeather,
  onCycleVision,
  onFlyToUser,
  onOpenParams
}: OrbitalControlsProps) => {
  const [collapsed, setCollapsed] = useState(false);

  const triggerHaptic = () => {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
    } catch {}
  };

  const handleToggle3D = () => {
    triggerHaptic();
    if (!map) return;
    const currentPitch = map.getPitch();
    if (currentPitch > 20) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    } else {
      map.easeTo({ pitch: 58, bearing: -12, duration: 1000 });
    }
  };

  const handleFlyOrbit = () => {
    triggerHaptic();
    if (!map) return;
    map.flyTo({
      center: [31.5, 30.0],
      zoom: 2.2,
      pitch: 42,
      bearing: 0,
      duration: 1600
    });
  };

  const handleResetUkraine = () => {
    triggerHaptic();
    if (!map) return;
    map.flyTo({
      center: [31.5, 49.0],
      zoom: 6.0,
      pitch: 52,
      bearing: -10,
      duration: 1200
    });
  };

  const getVisionIcon = () => {
    switch (visionMode) {
      case "satellite":
        return "🛰️";
      case "nvg":
        return "🟢";
      case "flir":
        return "🔥";
      case "tactical":
        return "🗺️";
    }
  };

  const getVisionLabel = () => {
    switch (visionMode) {
      case "satellite":
        return "Супутник";
      case "nvg":
        return "ПНБ";
      case "flir":
        return "FLIR";
      case "tactical":
        return "Вектор";
    }
  };

  return (
    <div className={`orbital-controls-dock ${collapsed ? "is-collapsed" : ""}`}>
      <button
        type="button"
        className="dock-toggle-btn"
        onClick={() => {
          triggerHaptic();
          setCollapsed((prev) => !prev);
        }}
        title={collapsed ? "Розгорнути панель управління" : "Згорнути панель управління"}
      >
        {collapsed ? "🛡️" : "✕"}
      </button>

      {!collapsed && (
        <div className="dock-buttons">
          <button
            type="button"
            className="orbital-btn"
            onClick={handleFlyOrbit}
            title="Орбітальний огляд всієї планети"
          >
            <span className="btn-icon">🌍</span>
            <span className="btn-label">Орбіта</span>
          </button>

          <button
            type="button"
            className="orbital-btn"
            onClick={handleResetUkraine}
            title="Фокус на театрі дій: Україна"
          >
            <span className="btn-icon">🇺🇦</span>
            <span className="btn-label">Україна</span>
          </button>

          <button
            type="button"
            className="orbital-btn"
            onClick={handleToggle3D}
            title="Перемикання 3D/2D проєкції"
          >
            <span className="btn-icon">🪐</span>
            <span className="btn-label">3D/2D</span>
          </button>

          <button
            type="button"
            className="orbital-btn active"
            onClick={() => {
              triggerHaptic();
              onCycleVision();
            }}
            title="Режим оптики (Супутник / ПНБ / FLIR / Вектор)"
          >
            <span className="btn-icon">{getVisionIcon()}</span>
            <span className="btn-label">{getVisionLabel()}</span>
          </button>

          {onToggleDayNight && (
            <button
              type="button"
              className={`orbital-btn ${showDayNight ? "active" : ""}`}
              onClick={() => {
                triggerHaptic();
                onToggleDayNight();
              }}
              title="Динамічне сонячне освітлення планети"
            >
              <span className="btn-icon">{showDayNight ? "☀️" : "🌙"}</span>
              <span className="btn-label">{showDayNight ? "Сонце" : "Ніч"}</span>
            </button>
          )}

          {onToggleWeather && (
            <button
              type="button"
              className={`orbital-btn ${showWeather ? "active" : ""}`}
              onClick={() => {
                triggerHaptic();
                onToggleWeather();
              }}
              title="Радар опадів RainViewer у реальному часі"
            >
              <span className="btn-icon">🌦️</span>
              <span className="btn-label">Хмари</span>
            </button>
          )}

          <button
            type="button"
            className="orbital-btn"
            onClick={() => {
              triggerHaptic();
              onFlyToUser();
            }}
            title="Моя геопозиція (GPS)"
          >
            <span className="btn-icon">📍</span>
            <span className="btn-label">До мене</span>
          </button>

          <button
            type="button"
            className="orbital-btn"
            onClick={() => {
              triggerHaptic();
              onOpenParams();
            }}
            title="Тактичні параметри та фільтри"
          >
            <span className="btn-icon">⚙️</span>
            <span className="btn-label">Фільтри</span>
          </button>
        </div>
      )}
    </div>
  );
};
