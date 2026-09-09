import type { Map } from "maplibre-gl";

interface OrbitalControlsProps {
  map: Map | null;
  satelliteMode: boolean;
  onToggleSatellite: () => void;
  onFlyToUser: () => void;
}

export const OrbitalControls = ({
  map,
  satelliteMode,
  onToggleSatellite,
  onFlyToUser
}: OrbitalControlsProps) => {
  const handleToggle3D = () => {
    if (!map) return;
    const currentPitch = map.getPitch();
    if (currentPitch > 20) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    } else {
      map.easeTo({ pitch: 58, bearing: -12, duration: 1000 });
    }
  };

  const handleResetUkraine = () => {
    if (!map) return;
    map.flyTo({
      center: [31.5, 49.0],
      zoom: 6.0,
      pitch: 52,
      bearing: -10,
      duration: 1200
    });
  };

  return (
    <div className="orbital-controls">
      <button className="orbital-btn" onClick={handleToggle3D} title="Перемикання 3D/2D">
        🪐 3D / 2D
      </button>
      <button
        className={`orbital-btn ${satelliteMode ? "active" : ""}`}
        onClick={onToggleSatellite}
        title="Супутниковий режим"
      >
        {satelliteMode ? "🛰️ Супутник" : "🗺️ Радар"}
      </button>
      <button className="orbital-btn" onClick={handleResetUkraine} title="Огляд України">
        🇺🇦 Україна
      </button>
      <button className="orbital-btn" onClick={onFlyToUser} title="Моя позиція">
        📍 До мене
      </button>
    </div>
  );
};
