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

  const getVisionTitle = () => {
    switch (visionMode) {
      case "satellite":
        return "🛰️ Супутник";
      case "nvg":
        return "🟢 ПНБ (Ніч)";
      case "flir":
        return "🔥 FLIR (Тепло)";
      case "tactical":
        return "🗺️ Вектор";
    }
  };

  return (
    <div className="orbital-controls">
      <button
        type="button"
        className="orbital-btn"
        onClick={handleFlyOrbit}
        title="Орбітальний огляд всієї планети"
      >
        🌍 Орбіта
      </button>

      {onToggleDayNight && (
        <button
          type="button"
          className={`orbital-btn ${showDayNight ? "active" : ""}`}
          onClick={() => {
            triggerHaptic();
            onToggleDayNight();
          }}
          title="Динамічний цикл дня і ночі на планеті"
        >
          {showDayNight ? "☀️/🌙 Доба" : "☀️ День"}
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
          title="Радар опадів та хмарності в реальному часі (RainViewer)"
        >
          {showWeather ? "🌦️ Погода" : "⛅ Без хмар"}
        </button>
      )}

      <button
        type="button"
        className="orbital-btn"
        onClick={handleToggle3D}
        title="Перемикання 3D/2D"
      >
        🪐 3D/2D
      </button>

      <button
        type="button"
        className="orbital-btn active"
        onClick={() => {
          triggerHaptic();
          onCycleVision();
        }}
        title="Перемикання оптичних та сенсорних режимів"
      >
        {getVisionTitle()}
      </button>

      <button
        type="button"
        className="orbital-btn"
        onClick={handleResetUkraine}
        title="Театр дій: Україна"
      >
        🇺🇦 Україна
      </button>

      <button
        type="button"
        className="orbital-btn"
        onClick={() => {
          triggerHaptic();
          onFlyToUser();
        }}
        title="Моя позиція"
      >
        📍 До мене
      </button>
    </div>
  );
};
