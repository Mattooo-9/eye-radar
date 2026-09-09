import type { Map } from "maplibre-gl";
import type { VisionMode } from "./MapView";

interface OrbitalControlsProps {
  map: Map | null;
  visionMode: VisionMode;
  onCycleVision: () => void;
  onFlyToUser: () => void;
}

export const OrbitalControls = ({
  map,
  visionMode,
  onCycleVision,
  onFlyToUser
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
        return "🗺️ Векторний";
    }
  };

  return (
    <div className="orbital-controls">
      <button className="orbital-btn" onClick={handleToggle3D} title="Перемикання 3D/2D">
        🪐 3D / 2D
      </button>
      <button
        className={`orbital-btn active`}
        onClick={() => {
          triggerHaptic();
          onCycleVision();
        }}
        title="Перемикання оптичних та сенсорних режимів"
      >
        {getVisionTitle()}
      </button>
      <button className="orbital-btn" onClick={handleResetUkraine} title="Огляд України">
        🇺🇦 Україна
      </button>
      <button
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
