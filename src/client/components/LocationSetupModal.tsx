import React, { useMemo, useState } from "react";
import { LOCATIONS } from "./CitySelector";

export interface ConfirmedLocation {
  lat: number;
  lon: number;
  name: string;
  region?: string;
}

export const OBLASTS_OF_UKRAINE = [
  { name: "Київ (Столиця)", center: { lat: 50.4501, lon: 30.5234 }, region: "Київ" },
  { name: "Вінницька область", center: { lat: 49.2331, lon: 28.4682 }, region: "Вінницька обл." },
  { name: "Волинська область", center: { lat: 50.7472, lon: 25.3254 }, region: "Волинська обл." },
  { name: "Дніпропетровська область", center: { lat: 48.4647, lon: 35.0462 }, region: "Дніпропетровська обл." },
  { name: "Донецька область", center: { lat: 48.739, lon: 37.5838 }, region: "Донецька обл." },
  { name: "Житомирська область", center: { lat: 50.2547, lon: 28.6587 }, region: "Житомирська обл." },
  { name: "Закарпатська область", center: { lat: 48.6208, lon: 22.2879 }, region: "Закарпатська обл." },
  { name: "Запорізька область", center: { lat: 47.8388, lon: 35.1396 }, region: "Запорізька обл." },
  { name: "Івано-Франківська область", center: { lat: 48.9226, lon: 24.7111 }, region: "Івано-Франківська обл." },
  { name: "Київська область", center: { lat: 50.4501, lon: 30.5234 }, region: "Київська обл." },
  { name: "Кіровоградська область", center: { lat: 48.5079, lon: 32.2623 }, region: "Кіровоградська обл." },
  { name: "Луганська область", center: { lat: 48.95, lon: 38.4833 }, region: "Луганська обл." },
  { name: "Львівська область", center: { lat: 49.8397, lon: 24.0297 }, region: "Львівська обл." },
  { name: "Миколаївська область", center: { lat: 46.975, lon: 31.9946 }, region: "Миколаївська обл." },
  { name: "Одеська область", center: { lat: 46.4825, lon: 30.7233 }, region: "Одеська обл." },
  { name: "Полтавська область", center: { lat: 49.5883, lon: 34.5514 }, region: "Полтавська обл." },
  { name: "Рівненська область", center: { lat: 50.6199, lon: 26.2516 }, region: "Рівненська обл." },
  { name: "Сумська область", center: { lat: 50.9077, lon: 34.7981 }, region: "Сумська обл." },
  { name: "Тернопільська область", center: { lat: 49.5535, lon: 25.5948 }, region: "Тернопільська обл." },
  { name: "Харківська область", center: { lat: 49.9935, lon: 36.2304 }, region: "Харківська обл." },
  { name: "Херсонська область", center: { lat: 46.6354, lon: 32.6169 }, region: "Херсонська обл." },
  { name: "Хмельницька область", center: { lat: 49.4229, lon: 26.9871 }, region: "Хмельницька обл." },
  { name: "Черкаська область", center: { lat: 49.4444, lon: 32.0598 }, region: "Черкаська обл." },
  { name: "Чернівецька область", center: { lat: 48.2917, lon: 25.9352 }, region: "Чернівецька обл." },
  { name: "Чернігівська область", center: { lat: 51.4982, lon: 31.2893 }, region: "Чернігівська обл." },
  { name: "АР Крим", center: { lat: 44.9521, lon: 34.1024 }, region: "АР Крим" }
];

interface LocationSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLocation?: ConfirmedLocation | null;
  onConfirmLocation: (location: ConfirmedLocation) => void;
  onStartPickOnMap: () => void;
  isFirstLaunch?: boolean;
}

export const LocationSetupModal: React.FC<LocationSetupModalProps> = ({
  isOpen,
  onClose,
  currentLocation,
  onConfirmLocation,
  onStartPickOnMap,
  isFirstLaunch = false
}) => {
  const [tab, setTab] = useState<"gps" | "search" | "region" | "map">("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPending, setSelectedPending] = useState<ConfirmedLocation | null>(
    currentLocation ?? null
  );
  const [isLocating, setIsLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  if (!isOpen) return null;

  const triggerHaptic = () => {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
    } catch {}
  };

  const handleAutoDetect = () => {
    triggerHaptic();
    setIsLocating(true);
    setGpsError(null);

    if (!navigator.geolocation) {
      setIsLocating(false);
      setGpsError("Геолокація не підтримується цим пристроєм");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const lat = Math.round(pos.coords.latitude * 10000) / 10000;
        const lon = Math.round(pos.coords.longitude * 10000) / 10000;

        // Find closest recognized city from LOCATIONS
        let closestName = "Моя GPS локація";
        let closestDist = Infinity;
        for (const loc of LOCATIONS) {
          const d = Math.hypot(loc.lat - lat, loc.lon - lon);
          if (d < closestDist && d < 0.4) {
            closestDist = d;
            closestName = loc.name;
          }
        }

        const resolved: ConfirmedLocation = {
          lat,
          lon,
          name: closestName,
          region: "GPS"
        };
        setSelectedPending(resolved);
      },
      (err) => {
        setIsLocating(false);
        setGpsError("Доступ до геопозиції відхилено або недоступний");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const filteredCities = useMemo(() => {
    if (!searchQuery.trim()) return LOCATIONS;
    const q = searchQuery.toLowerCase().trim();
    return LOCATIONS.filter(
      (loc) => loc.name.toLowerCase().includes(q) || loc.region.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleConfirm = () => {
    if (!selectedPending) return;
    triggerHaptic();
    onConfirmLocation(selectedPending);
    onClose();
  };

  return (
    <div className="location-setup-overlay" onClick={isFirstLaunch ? undefined : onClose}>
      <div className="location-setup-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="location-setup-header">
          <div className="location-setup-title-box">
            <span className="location-setup-icon">📍</span>
            <div>
              <div className="location-setup-title">
                {isFirstLaunch ? "ВСТАНОВЛЕННЯ ЛОКАЦІЇ" : "ЗМІНА МОЄЇ ЛОКАЦІЇ"}
              </div>
              <div className="location-setup-sub">
                Потрібна для адресного розрахунку наближення повітряних загроз
              </div>
            </div>
          </div>
          {!isFirstLaunch && (
            <button type="button" className="location-setup-close" onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        {/* Currently Selected Banner */}
        {selectedPending && (
          <div className="location-selected-banner">
            <span className="selected-dot">●</span>
            <div className="selected-text">
              <strong>{selectedPending.name}</strong>
              {selectedPending.region && ` (${selectedPending.region})`}
              <span className="selected-coords">
                {selectedPending.lat.toFixed(4)}°N, {selectedPending.lon.toFixed(4)}°E
              </span>
            </div>
          </div>
        )}

        {/* Method Selector Tabs */}
        <div className="location-method-tabs">
          <button
            type="button"
            className={`location-tab-btn ${tab === "search" ? "active" : ""}`}
            onClick={() => {
              triggerHaptic();
              setTab("search");
            }}
          >
            🔍 Місто
          </button>
          <button
            type="button"
            className={`location-tab-btn ${tab === "gps" ? "active" : ""}`}
            onClick={() => {
              triggerHaptic();
              setTab("gps");
              if (!selectedPending || selectedPending.region !== "GPS") {
                handleAutoDetect();
              }
            }}
          >
            🛰️ GPS
          </button>
          <button
            type="button"
            className={`location-tab-btn ${tab === "region" ? "active" : ""}`}
            onClick={() => {
              triggerHaptic();
              setTab("region");
            }}
          >
            🏛️ Область
          </button>
          <button
            type="button"
            className={`location-tab-btn ${tab === "map" ? "active" : ""}`}
            onClick={() => {
              triggerHaptic();
              setTab("map");
            }}
          >
            🗺️ Карта
          </button>
        </div>

        {/* Tab 1: City Search */}
        {tab === "search" && (
          <div className="location-tab-content">
            <div className="location-search-input-wrap">
              <span className="search-prefix">🔍</span>
              <input
                type="text"
                className="location-search-input"
                placeholder="Почніть вводити назву міста..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery("")}
                >
                  ✕
                </button>
              )}
            </div>

            <div className="location-cities-scroll">
              {filteredCities.map((loc) => {
                const isSelected =
                  selectedPending?.lat === loc.lat && selectedPending?.lon === loc.lon;
                return (
                  <button
                    key={`${loc.name}-${loc.region}`}
                    type="button"
                    className={`location-item-row ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      triggerHaptic();
                      setSelectedPending({
                        lat: loc.lat,
                        lon: loc.lon,
                        name: loc.name,
                        region: loc.region
                      });
                    }}
                  >
                    <div className="location-item-main">
                      <strong>{loc.name}</strong>
                      <span className="location-item-sub">{loc.region}</span>
                    </div>
                    {isSelected && <span className="location-check">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: GPS Auto-detect */}
        {tab === "gps" && (
          <div className="location-tab-content gps-tab">
            <div className="gps-auto-box">
              <span className="gps-big-icon">🛰️</span>
              <div className="gps-auto-title">Супутникова автонавігація</div>
              <div className="gps-auto-desc">
                Визначення точних координат вашого пристрою без передачі особистих даних
              </div>

              {isLocating ? (
                <div className="gps-locating-pill">⏳ Отримання супутникових координат...</div>
              ) : (
                <button
                  type="button"
                  className="gps-refresh-btn"
                  onClick={handleAutoDetect}
                >
                  🛰️ Оновити координати GPS
                </button>
              )}

              {gpsError && <div className="gps-error-notice">⚠️ {gpsError}</div>}
            </div>
          </div>
        )}

        {/* Tab 3: Region / Oblast Picker */}
        {tab === "region" && (
          <div className="location-tab-content">
            <div className="location-regions-grid">
              {OBLASTS_OF_UKRAINE.map((ob) => {
                const isSelected =
                  selectedPending?.lat === ob.center.lat && selectedPending?.lon === ob.center.lon;
                return (
                  <button
                    key={ob.name}
                    type="button"
                    className={`location-region-card ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      triggerHaptic();
                      setSelectedPending({
                        lat: ob.center.lat,
                        lon: ob.center.lon,
                        name: ob.name,
                        region: ob.region
                      });
                    }}
                  >
                    <span className="region-icon">🏛️</span>
                    <span className="region-name">{ob.name}</span>
                    {isSelected && <span className="region-check">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 4: Pick on Map */}
        {tab === "map" && (
          <div className="location-tab-content map-tab">
            <div className="map-pick-box">
              <span className="map-pick-icon">🎯</span>
              <div className="map-pick-title">Вказати точку безпосередньо на карті</div>
              <div className="map-pick-desc">
                Натисніть кнопку нижче, щоб перейти на карту. Потім клікніть у потрібне місце на карті
                та збережіть точку.
              </div>

              <button
                type="button"
                className="map-start-pick-btn"
                onClick={() => {
                  triggerHaptic();
                  onStartPickOnMap();
                  onClose();
                }}
              >
                📍 Перейти до вибору на карті
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="location-setup-footer">
          <button
            type="button"
            className="location-confirm-btn"
            disabled={!selectedPending}
            onClick={handleConfirm}
          >
            {selectedPending
              ? `✓ ПІДТВЕРДИТИ: ${selectedPending.name}`
              : "Оберіть населений пункт або точку"}
          </button>
        </div>
      </div>
    </div>
  );
};
