import { useState } from "react";

interface CitySelectorProps {
  onSelectCity: (lat: number, lon: number, cityName: string) => void;
  isManual?: boolean;
  isPickingLocation?: boolean;
  onTogglePickLocation?: () => void;
  onResetGps?: () => void;
}

const CITIES = [
  { name: "Київ", lat: 50.4501, lon: 30.5234 },
  { name: "Харків", lat: 49.9935, lon: 36.2304 },
  { name: "Дніпро", lat: 48.4647, lon: 35.0462 },
  { name: "Одеса", lat: 46.4825, lon: 30.7233 },
  { name: "Запоріжжя", lat: 47.8388, lon: 35.1396 },
  { name: "Львів", lat: 49.8397, lon: 24.0297 },
  { name: "Полтава", lat: 49.5883, lon: 34.5514 },
  { name: "Вінниця", lat: 49.2331, lon: 28.4682 },
  { name: "Черкаси", lat: 49.4444, lon: 32.0598 },
  { name: "Миколаїв", lat: 46.975, lon: 31.9946 },
  { name: "Чернігів", lat: 51.4982, lon: 31.2893 },
  { name: "Суми", lat: 50.9077, lon: 34.7981 },
  { name: "Кривий Ріг", lat: 47.9105, lon: 33.3918 },
  { name: "Житомир", lat: 50.2547, lon: 28.6587 },
  { name: "Кременчук", lat: 49.063, lon: 33.404 }
];

export const CitySelector = ({
  onSelectCity,
  isManual,
  isPickingLocation,
  onTogglePickLocation,
  onResetGps
}: CitySelectorProps) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="city-selector-container">
      <button
        type="button"
        className={`city-btn ${!isManual ? "active-gps" : ""}`}
        onClick={onResetGps}
        title="Автоматичний GPS спостерігача"
      >
        🛰️ GPS {!isManual && "●"}
      </button>

      <button
        type="button"
        className={`city-btn ${isPickingLocation ? "picking-active" : ""}`}
        onClick={onTogglePickLocation}
        title="Вказати точку спостереження на карті"
      >
        🎯 {isPickingLocation ? "Клікніть на карту..." : "Точка"}
      </button>

      <button
        type="button"
        className="city-btn"
        onClick={() => setOpen(!open)}
      >
        🏙️ Міста
      </button>

      {open && (
        <div className="city-dropdown">
          <div className="city-dropdown-header">
            <span>Швидка локація</span>
            <button className="close-btn" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="city-list">
            {CITIES.map((c) => (
              <button
                key={c.name}
                className="city-item"
                onClick={() => {
                  onSelectCity(c.lat, c.lon, c.name);
                  setOpen(false);
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
