import { useState, useRef, useEffect } from "react";
import type { Map } from "maplibre-gl";
import type { VisionMode } from "./MapView";

interface OrbitalControlsProps {
  map: Map | null;
  visionMode: VisionMode;
  showDayNight?: boolean;
  onToggleDayNight?: () => void;
  showWeather?: boolean;
  onToggleWeather?: () => void;
  showSatellites?: boolean;
  onToggleSatellites?: () => void;
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
  showSatellites = true,
  onToggleSatellites,
  onCycleVision,
  onFlyToUser,
  onOpenParams
}: OrbitalControlsProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  const triggerHaptic = () => {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
    } catch {}
  };

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = window.setTimeout(() => {
      setIsOpen(false);
    }, 320);
  };

  const handleToggleClick = () => {
    triggerHaptic();
    setIsOpen((prev) => !prev);
  };

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

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
      zoom: 6.2,
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
    <div
      ref={containerRef}
      className={`orbital-controls-dock ${isOpen ? "is-open" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        className="dock-toggle-pill"
        onClick={handleToggleClick}
        title="Опції та управління мапою (наведіть або натисніть)"
        aria-expanded={isOpen}
      >
        <span className="dock-pill-icon">{getVisionIcon()}</span>
        <span className="dock-pill-text">Опції</span>
        <span className="dock-pill-chevron">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="dock-dropdown-menu">
          <div className="dropdown-grid">
            <button
              type="button"
              className="dropdown-item"
              onClick={handleFlyOrbit}
              title="Орбітальний огляд всієї планети"
            >
              <span className="item-icon">🌍</span>
              <span className="item-label">Орбіта</span>
            </button>

            <button
              type="button"
              className="dropdown-item"
              onClick={handleResetUkraine}
              title="Фокус на театрі дій: Україна"
            >
              <span className="item-icon">🇺🇦</span>
              <span className="item-label">Україна</span>
            </button>

            <button
              type="button"
              className="dropdown-item"
              onClick={handleToggle3D}
              title="Перемикання 3D/2D проєкції"
            >
              <span className="item-icon">🪐</span>
              <span className="item-label">3D/2D</span>
            </button>

            <button
              type="button"
              className="dropdown-item active-vision"
              onClick={() => {
                triggerHaptic();
                onCycleVision();
              }}
              title="Режим оптики: Супутник / ПНБ / FLIR / Вектор"
            >
              <span className="item-icon">{getVisionIcon()}</span>
              <span className="item-label">{getVisionLabel()}</span>
            </button>

            {onToggleDayNight && (
              <button
                type="button"
                className={`dropdown-item ${showDayNight ? "active-toggle" : ""}`}
                onClick={() => {
                  triggerHaptic();
                  onToggleDayNight();
                }}
                title="Динамічне сонячне освітлення (День / Ніч)"
              >
                <span className="item-icon">{showDayNight ? "☀️" : "🌙"}</span>
                <span className="item-label">{showDayNight ? "Сонце" : "Ніч"}</span>
              </button>
            )}

            {onToggleWeather && (
              <button
                type="button"
                className={`dropdown-item ${showWeather ? "active-toggle" : ""}`}
                onClick={() => {
                  triggerHaptic();
                  onToggleWeather();
                }}
                title="Радар опадів та хмарності RainViewer"
              >
                <span className="item-icon">🌦️</span>
                <span className="item-label">{showWeather ? "Хмари ON" : "Хмари OFF"}</span>
              </button>
            )}

            {onToggleSatellites && (
              <button
                type="button"
                className={`dropdown-item ${showSatellites ? "active-toggle" : ""}`}
                onClick={() => {
                  triggerHaptic();
                  onToggleSatellites();
                }}
                title="Орбітальні розвідсупутники РФ (Персона, Барс, Лотос, Кондор-ФКА)"
              >
                <span className="item-icon">🛰️</span>
                <span className="item-label">Супутники</span>
              </button>
            )}

            <button
              type="button"
              className="dropdown-item"
              onClick={() => {
                triggerHaptic();
                onFlyToUser();
              }}
              title="Моя геопозиція (GPS)"
            >
              <span className="item-icon">📍</span>
              <span className="item-label">До мене</span>
            </button>

            <button
              type="button"
              className="dropdown-item highlight-btn"
              onClick={() => {
                triggerHaptic();
                onOpenParams();
              }}
              title="Тактичні параметри та фільтри швидкості/висоти"
            >
              <span className="item-icon">⚙️</span>
              <span className="item-label">Фільтри</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};