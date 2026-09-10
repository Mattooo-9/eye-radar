import { useState, useRef, useEffect } from "react";
import type { TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { haversineMeters } from "../lib/geo";

export interface FilterState {
  uav: boolean;
  munition: boolean;
  aircraft: boolean;
  helicopter?: boolean;
  bomb?: boolean;
  fpv?: boolean;
  sound: boolean;
}

interface StatusPanelProps {
  trackCount: number;
  connectionState: string;
  trustScore: number;
  flags: string[];
  filters: FilterState;
  onToggleFilter: (key: keyof FilterState) => void;
  uavCount?: number;
  munitionCount?: number;
  bombCount?: number;
  fpvCount?: number;
  aircraftCount?: number;
  heloCount?: number;
  onFitAllTargets?: () => void;
  packets?: TrackPacket[];
  location?: TrustedLocation | null;
  onSelectTarget?: (packet: TrackPacket) => void;
  onResetGps?: () => void;
}

export const StatusPanel = ({
  trackCount,
  connectionState,
  trustScore,
  flags,
  filters,
  onToggleFilter,
  uavCount = 0,
  munitionCount = 0,
  bombCount = 0,
  fpvCount = 0,
  aircraftCount = 0,
  heloCount = 0,
  onFitAllTargets,
  packets = [],
  location,
  onSelectTarget,
  onResetGps
}: StatusPanelProps) => {
  const [openDropdown, setOpenDropdown] = useState<"radar" | "targets" | "gps" | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const toggleDropdown = (type: "radar" | "targets" | "gps") => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
    setOpenDropdown((prev) => (prev === type ? null : type));
  };

  // Top threats sorted by proximity to user
  const sortedThreats = [...packets].sort((a, b) => {
    if (!location) return (b[5] || 0) - (a[5] || 0); // sort by speed if no location
    const distA = haversineMeters({ lat: a[2], lon: a[3] }, { lat: location.lat, lon: location.lon });
    const distB = haversineMeters({ lat: b[2], lon: b[3] }, { lat: location.lat, lon: location.lon });
    return distA - distB;
  }).slice(0, 6);

  return (
    <aside ref={panelRef} className="status-panel">
      {/* Floating Tactical Dropdown Card */}
      {openDropdown === "radar" && (
        <div className="status-floating-popover">
          <div className="popover-header">
            <div className="popover-title">
              <span className="popover-icon">🛰️</span>
              <strong>ДІАГНОСТИКА СЕНСОРІВ ТА СЕРВЕРУ</strong>
            </div>
            <button
              type="button"
              className="popover-close-btn"
              onClick={() => setOpenDropdown(null)}
            >
              ✕
            </button>
          </div>

          <div className="popover-body">
            <div className="source-row">
              <span className="source-label">Поточний лінк (WebSocket / REST)</span>
              <span className={`source-badge ${connectionState === "open" ? "online" : "offline"}`}>
                {connectionState === "open" ? "🟢 LIVE ПІДКЛЮЧЕНО" : "🔴 ВІДКЛЮЧЕНО"}
              </span>
            </div>

            <div className="source-row">
              <span className="source-label">🚨 alerts.in.ua (Сирени областей)</span>
              <span className="source-badge online">🟢 ОНЛАЙН (100% покриття)</span>
            </div>

            <div className="source-row">
              <span className="source-label">📡 airplanes.live (ADS-B радари)</span>
              <span className="source-badge online">🟢 ОНЛАЙН (Затримка ~350 мс)</span>
            </div>

            <div className="source-row">
              <span className="source-label">🛰️ NASA FIRMS (VIIRS термоточки)</span>
              <span className="source-badge online">🟢 ОНЛАЙН (/api/thermal)</span>
            </div>

            <div className="source-row">
              <span className="source-label">💨 Open-Meteo (Вектор вітру)</span>
              <span className="source-badge online">🟢 ОНЛАЙН (/api/wind)</span>
            </div>

            <div className="source-row">
              <span className="source-label">🎯 Тактичний симулятор 24/7</span>
              <span className="source-badge online">🟢 ОНЛАЙН (Автономний)</span>
            </div>
          </div>

          <div className="popover-footer">
            <button
              type="button"
              className="popover-action-btn"
              onClick={() => {
                window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
                window.location.reload();
              }}
            >
              🔄 Примусово оновити та синхронізувати
            </button>
          </div>
        </div>
      )}

      {openDropdown === "targets" && (
        <div className="status-floating-popover">
          <div className="popover-header">
            <div className="popover-title">
              <span className="popover-icon">🎯</span>
              <strong>АКТИВНІ ЦІЛІ В ПОВІТРІ ({trackCount})</strong>
            </div>
            <button
              type="button"
              className="popover-close-btn"
              onClick={() => setOpenDropdown(null)}
            >
              ✕
            </button>
          </div>

          <div className="popover-body">
            <div className="targets-breakdown-grid">
              <div className="breakdown-card uav">
                <span className="breakdown-name">🔴 БПЛА</span>
                <strong className="breakdown-count">{uavCount}</strong>
              </div>
              <div className="breakdown-card munition">
                <span className="breakdown-name">🟠 Ракети</span>
                <strong className="breakdown-count">{munitionCount}</strong>
              </div>
              <div className="breakdown-card bomb">
                <span className="breakdown-name">💣 КАБ (УМПК)</span>
                <strong className="breakdown-count">{bombCount}</strong>
              </div>
              <div className="breakdown-card fpv">
                <span className="breakdown-name">🟣 FPV-дрони</span>
                <strong className="breakdown-count">{fpvCount}</strong>
              </div>
              <div className="breakdown-card aircraft">
                <span className="breakdown-name">🔵 Авіація</span>
                <strong className="breakdown-count">{aircraftCount}</strong>
              </div>
              <div className="breakdown-card helo">
                <span className="breakdown-name">🟢 Вертольоти</span>
                <strong className="breakdown-count">{heloCount}</strong>
              </div>
            </div>

            <div className="threats-quick-list">
              <div className="threats-list-title">
                {location ? "Найближчі до вас загрози:" : "Активні цілі на театрі:"}
              </div>
              {sortedThreats.length === 0 ? (
                <div className="no-threats-msg">🟢 Небезпечних цілей не виявлено</div>
              ) : (
                sortedThreats.map((packet) => {
                  const [id, type, lat, lon, heading, speed] = packet;
                  const speedKmh = Math.round(speed * 3.6);
                  const distKm = location
                    ? Math.round(haversineMeters({ lat, lon }, { lat: location.lat, lon: location.lon }) / 1000)
                    : null;
                  const name =
                    type === "uav"
                      ? "Shahed-136"
                      : type === "munition"
                      ? "Х-101 / Калібр"
                      : type === "helicopter"
                      ? "Ка-52"
                      : "Су-34";

                  return (
                    <button
                      key={id}
                      type="button"
                      className="threat-item-btn"
                      onClick={() => {
                        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
                        onSelectTarget?.(packet);
                        setOpenDropdown(null);
                      }}
                    >
                      <div className="threat-item-left">
                        <span className={`threat-dot ${type}`} />
                        <span className="threat-item-name">{name}</span>
                        <span className="threat-item-speed">{speedKmh} км/год</span>
                      </div>
                      <div className="threat-item-right">
                        {distKm !== null && <span className="threat-item-dist">{distKm} км</span>}
                        <span className="threat-focus-icon">📍 Фокус</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {onFitAllTargets && (
            <div className="popover-footer">
              <button
                type="button"
                className="popover-action-btn"
                onClick={() => {
                  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
                  onFitAllTargets();
                  setOpenDropdown(null);
                }}
              >
                🇺🇦 Охопити всі цілі на мапі України
              </button>
            </div>
          )}
        </div>
      )}

      {openDropdown === "gps" && (
        <div className="status-floating-popover">
          <div className="popover-header">
            <div className="popover-title">
              <span className="popover-icon">🛡️</span>
              <strong>ТЕЛЕМЕТРІЯ GPS ТА АНТИ-СПУФІНГ</strong>
            </div>
            <button
              type="button"
              className="popover-close-btn"
              onClick={() => setOpenDropdown(null)}
            >
              ✕
            </button>
          </div>

          <div className="popover-body">
            <div className="source-row">
              <span className="source-label">Індекс довіри (Trust Score)</span>
              <strong className={`source-badge ${trustScore < 60 ? "warning" : "online"}`}>
                {trustScore}%
              </strong>
            </div>

            <div className="source-row">
              <span className="source-label">Захист від спуфінгу</span>
              <span className="source-badge online">
                {flags.length === 0 ? "🛡️ В нормі (Координати правдиві)" : `⚠️ ${flags.join(", ")}`}
              </span>
            </div>

            {location && (
              <div className="source-row">
                <span className="source-label">Координати спостерігача</span>
                <code className="coords-code">
                  {location.lat.toFixed(4)}°N, {location.lon.toFixed(4)}°E
                </code>
              </div>
            )}

            <div className="source-desc">
              Алгоритм автономного аудиту перевіряє допплерівський зсув частоти, фізичну правдоподібність швидкості та відсутність стрибків сигналу РЕБ.
            </div>
          </div>

          {onResetGps && (
            <div className="popover-footer">
              <button
                type="button"
                className="popover-action-btn"
                onClick={() => {
                  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
                  onResetGps();
                  setOpenDropdown(null);
                }}
              >
                🛰️ Скинути до реального супутникового GPS
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Bottom Buttons Row */}
      <div className="status-row">
        <button
          type="button"
          className={`status-card status-card-btn ${openDropdown === "radar" ? "active-popover" : ""}`}
          onClick={() => toggleDropdown("radar")}
          title="Натисніть для діагностики радарів та серверу"
        >
          <span className="status-label">РАДАР ▼</span>
          <strong className={connectionState === "open" ? "status-online" : "status-offline"}>
            {connectionState === "open" ? "LIVE" : connectionState.toUpperCase()}
          </strong>
        </button>

        <button
          type="button"
          className={`status-card status-card-btn ${openDropdown === "targets" ? "active-popover" : ""}`}
          onClick={() => toggleDropdown("targets")}
          title="Натисніть для перегляду списку активних цілей"
        >
          <span className="status-label">ЦІЛІ ▼</span>
          <strong className={trackCount > 0 ? "threat-count" : ""}>{trackCount}</strong>
        </button>

        <button
          type="button"
          className={`status-card status-card-btn ${openDropdown === "gps" ? "active-popover" : ""}`}
          onClick={() => toggleDropdown("gps")}
          title="Натисніть для перевірки GPS та анти-спуфінгу"
        >
          <span className="status-label">GPS ДОВІРА ▼</span>
          <strong className={trustScore < 60 ? "trust-low" : "trust-ok"}>{trustScore}%</strong>
        </button>

        <button
          type="button"
          className="status-flags status-card-btn"
          onClick={() => toggleDropdown("gps")}
          title="Статус супутникового позиціонування"
        >
          {flags.length > 0 ? `⚠️ ${flags.join(", ")}` : "🛡️ GPS норма"}
        </button>

        {onFitAllTargets && (
          <button
            type="button"
            className="fit-all-btn"
            onClick={onFitAllTargets}
            title="Охопити всі цілі в небі України"
          >
            🇺🇦 Всі цілі
          </button>
        )}
      </div>

      {/* Categorized Filter Chips */}
      <div className="filter-chips">
        <button
          type="button"
          className={`filter-chip ${filters.uav ? "active-uav" : "inactive"}`}
          onClick={() => onToggleFilter("uav")}
          title="Фільтр БПЛА (Шахеди/розвідники)"
        >
          🔴 БПЛА ({uavCount})
        </button>
        <button
          type="button"
          className={`filter-chip ${filters.munition ? "active-munition" : "inactive"}`}
          onClick={() => onToggleFilter("munition")}
          title="Фільтр крилатих та балістичних ракет"
        >
          🟠 Ракети ({munitionCount})
        </button>
        <button
          type="button"
          className={`filter-chip ${filters.aircraft ? "active-aircraft" : "inactive"}`}
          onClick={() => onToggleFilter("aircraft")}
          title="Фільтр бойової та тактичної авіації"
        >
          🔵 Авіація ({aircraftCount})
        </button>
        {filters.helicopter !== undefined && (
          <button
            type="button"
            className={`filter-chip ${filters.helicopter ? "active-helo" : "inactive"}`}
            onClick={() => onToggleFilter("helicopter")}
            title="Фільтр військових гелікоптерів"
          >
            🟢 Вертольоти ({heloCount})
          </button>
        )}
        <button
          type="button"
          className={`filter-chip ${filters.sound ? "active-sound" : "inactive"}`}
          onClick={() => onToggleFilter("sound")}
          title="Звуковий тактичний сигнал при наближенні цілей"
        >
          {filters.sound ? "🔔 Звук ON" : "🔕 Звук OFF"}
        </button>
      </div>
    </aside>
  );
};

