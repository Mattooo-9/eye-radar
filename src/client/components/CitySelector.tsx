import { useMemo, useState } from "react";

interface CitySelectorProps {
  onSelectCity: (lat: number, lon: number, cityName: string, zoomLevel?: number) => void;
  onFitAllTargets?: () => void;
  isManual?: boolean;
  isPickingLocation?: boolean;
  onTogglePickLocation?: () => void;
  onResetGps?: () => void;
}

interface UkrainianLocation {
  name: string;
  region: string;
  lat: number;
  lon: number;
  zoom?: number;
}

export const LOCATIONS: UkrainianLocation[] = [
  { name: "Київ", region: "Столиця", lat: 50.4501, lon: 30.5234, zoom: 10.5 },
  { name: "Харків", region: "Харківська обл.", lat: 49.9935, lon: 36.2304, zoom: 10.0 },
  { name: "Дніпро", region: "Дніпропетровська обл.", lat: 48.4647, lon: 35.0462, zoom: 10.0 },
  { name: "Одеса", region: "Одеська обл.", lat: 46.4825, lon: 30.7233, zoom: 10.0 },
  { name: "Запоріжжя", region: "Запорізька обл.", lat: 47.8388, lon: 35.1396, zoom: 10.0 },
  { name: "Львів", region: "Львівська обл.", lat: 49.8397, lon: 24.0297, zoom: 10.0 },
  { name: "Кривий Ріг", region: "Дніпропетровська обл.", lat: 47.9105, lon: 33.3918, zoom: 10.0 },
  { name: "Миколаїв", region: "Миколаївська обл.", lat: 46.975, lon: 31.9946, zoom: 10.0 },
  { name: "Вінниця", region: "Вінницька обл.", lat: 49.2331, lon: 28.4682, zoom: 10.0 },
  { name: "Полтава", region: "Полтавська обл.", lat: 49.5883, lon: 34.5514, zoom: 10.0 },
  { name: "Чернігів", region: "Чернігівська обл.", lat: 51.4982, lon: 31.2893, zoom: 10.0 },
  { name: "Черкаси", region: "Черкаська обл.", lat: 49.4444, lon: 32.0598, zoom: 10.0 },
  { name: "Суми", region: "Сумська обл.", lat: 50.9077, lon: 34.7981, zoom: 10.0 },
  { name: "Житомир", region: "Житомирська обл.", lat: 50.2547, lon: 28.6587, zoom: 10.0 },
  { name: "Хмельницький", region: "Хмельницька обл.", lat: 49.4229, lon: 26.9871, zoom: 10.0 },
  { name: "Рівне", region: "Рівненська обл.", lat: 50.6199, lon: 26.2516, zoom: 10.0 },
  { name: "Чернівці", region: "Чернівецька обл.", lat: 48.2917, lon: 25.9352, zoom: 10.0 },
  { name: "Кропивницький", region: "Кіровоградська обл.", lat: 48.5079, lon: 32.2623, zoom: 10.0 },
  { name: "Івано-Франківськ", region: "Івано-Франківська обл.", lat: 48.9226, lon: 24.7111, zoom: 10.0 },
  { name: "Кременчук", region: "Полтавська обл.", lat: 49.063, lon: 33.404, zoom: 10.0 },
  { name: "Тернопіль", region: "Тернопільська обл.", lat: 49.5535, lon: 25.5948, zoom: 10.0 },
  { name: "Луцьк", region: "Волинська обл.", lat: 50.7472, lon: 25.3254, zoom: 10.0 },
  { name: "Ужгород", region: "Закарпатська обл.", lat: 48.6208, lon: 22.2879, zoom: 10.0 },
  { name: "Херсон", region: "Херсонська обл.", lat: 46.6354, lon: 32.6169, zoom: 10.0 },
  { name: "Краматорськ", region: "Донецька обл.", lat: 48.739, lon: 37.5838, zoom: 10.0 },
  { name: "Біла Церква", region: "Київська обл.", lat: 49.7968, lon: 30.1312, zoom: 10.0 },
  { name: "Сєвєродонецьк", region: "Луганська обл.", lat: 48.95, lon: 38.4833, zoom: 10.0 },
  { name: "Севастополь", region: "АР Крим", lat: 44.6167, lon: 33.5254, zoom: 10.0 }
];

export const CitySelector = ({
  onSelectCity,
  onFitAllTargets,
  isManual,
  isPickingLocation,
  onTogglePickLocation,
  onResetGps
}: CitySelectorProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredLocations = useMemo(() => {
    if (!search.trim()) return LOCATIONS;
    const q = search.toLowerCase();
    return LOCATIONS.filter(
      (l) => l.name.toLowerCase().includes(q) || l.region.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div className="city-selector-container">
      <button
        type="button"
        className="city-btn ukraine-all-btn"
        onClick={() => {
          if (onFitAllTargets) {
            onFitAllTargets();
          } else {
            onSelectCity(49.0, 31.5, "Вся Україна", 6.0);
          }
        }}
        title="Показати всю Україну та охопити всі активні повітряні цілі"
      >
        🇺🇦 Вся Україна
      </button>

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
        className="city-btn"
        onClick={() => setOpen(!open)}
      >
        🏙️ Регіони ({LOCATIONS.length})
      </button>

      {open && (
        <div className="city-dropdown">
          <div className="city-dropdown-header">
            <span>Регіони та Міста</span>
            <button className="close-btn" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="city-search-box">
            <input
              type="text"
              className="city-search-input"
              placeholder="🔍 Пошук регіону чи міста..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="city-list">
            <button
              className="city-item all-country-item"
              onClick={() => {
                if (onFitAllTargets) {
                  onFitAllTargets();
                } else {
                  onSelectCity(49.0, 31.5, "Вся Україна", 6.0);
                }
                setOpen(false);
              }}
            >
              <strong>🇺🇦 Вся Україна (Всі цілі)</strong>
              <span className="city-sub">Загальне повітряне поле</span>
            </button>
            {filteredLocations.map((c) => (
              <button
                key={c.name}
                className="city-item"
                onClick={() => {
                  onSelectCity(c.lat, c.lon, c.name, c.zoom);
                  setOpen(false);
                }}
              >
                <strong>{c.name}</strong>
                <span className="city-sub">{c.region}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
