import React, { useState } from "react";
import type { Map } from "maplibre-gl";
import type { VisionMode } from "./MapView";
import type { FilterState } from "./StatusPanel";
import type { TrustedLocation } from "../location/useTrustedLocation";
import type { ImpactEvent, TrackPacket } from "../hooks/useWsRadar";
import { LOCATIONS } from "./CitySelector";

interface TacticalMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  map: Map | null;
  // Vision & Layers
  visionMode: VisionMode;
  onSelectVision: (mode: VisionMode) => void;
  showWeather: boolean;
  onToggleWeather: () => void;
  showSatellites: boolean;
  onToggleSatellites: () => void;
  showFrontline?: boolean;
  onToggleFrontline?: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  // Filters & Counts
  filters: FilterState;
  onToggleFilter: (key: keyof FilterState) => void;
  threatOnly: boolean;
  onToggleThreatOnly: () => void;
  uavCount: number;
  munitionCount: number;
  bombCount?: number;
  fpvCount?: number;
  aircraftCount: number;
  heloCount: number;
  totalTrackCount: number;
  onFitAllTargets: () => void;
  // Location
  location: TrustedLocation | null;
  isManual: boolean;
  isPickingLocation: boolean;
  onTogglePickLocation: () => void;
  onResetGps: () => void;
  onSelectCity: (lat: number, lon: number, name: string, zoom?: number) => void;
  // Impacts & Events
  impacts: ImpactEvent[];
  onFlyToCoord: (lat: number, lon: number) => void;
  // AI Briefing & Report
  onOpenBriefing: () => void;
  onOpenReport: () => void;
  activeAlerts: string[];
}

export const TacticalMenuModal: React.FC<TacticalMenuModalProps> = ({
  isOpen,
  onClose,
  map,
  visionMode,
  onSelectVision,
  showWeather,
  onToggleWeather,
  showSatellites,
  onToggleSatellites,
  showFrontline = true,
  onToggleFrontline,
  soundEnabled,
  onToggleSound,
  filters,
  onToggleFilter,
  threatOnly,
  onToggleThreatOnly,
  uavCount,
  munitionCount,
  bombCount = 0,
  fpvCount = 0,
  aircraftCount,
  heloCount,
  totalTrackCount,
  onFitAllTargets,
  location,
  isManual,
  isPickingLocation,
  onTogglePickLocation,
  onResetGps,
  onSelectCity,
  impacts,
  onFlyToCoord,
  onOpenBriefing,
  onOpenReport,
  activeAlerts
}) => {
  const [activeTab, setActiveTab] = useState<"targets" | "vision" | "layers" | "cities" | "impacts" | "intel">("targets");

  if (!isOpen) return null;

  const formatTimeAgo = (ts: number): string => {
    const diffSec = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (diffSec < 60) return `${diffSec} сек тому`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} хв тому`;
    return `${Math.floor(min / 60)} год тому`;
  };

  return (
    <div className="tactical-menu-overlay" onClick={onClose}>
      <div className="tactical-menu-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="tactical-menu-header">
          <div className="tactical-menu-title-row">
            <span className="tactical-menu-badge">EYE RADAR // MENU</span>
            <span className="tactical-menu-live-dot" />
            <strong className="tactical-menu-title">ОПЦІЇ ТА УПРАВЛІННЯ</strong>
          </div>
          <button type="button" className="tactical-menu-close" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="tactical-menu-nav">
          <button
            type="button"
            className={`tactical-nav-item ${activeTab === "targets" ? "active" : ""}`}
            onClick={() => setActiveTab("targets")}
          >
            🎯 Цілі ({totalTrackCount})
          </button>
          <button
            type="button"
            className={`tactical-nav-item ${activeTab === "vision" ? "active" : ""}`}
            onClick={() => setActiveTab("vision")}
          >
            🛰️ Оптика
          </button>
          <button
            type="button"
            className={`tactical-nav-item ${activeTab === "layers" ? "active" : ""}`}
            onClick={() => setActiveTab("layers")}
          >
            🌦️ Шари
          </button>
          <button
            type="button"
            className={`tactical-nav-item ${activeTab === "cities" ? "active" : ""}`}
            onClick={() => setActiveTab("cities")}
          >
            📍 Міста
          </button>
          <button
            type="button"
            className={`tactical-nav-item ${activeTab === "impacts" ? "active" : ""}`}
            onClick={() => setActiveTab("impacts")}
          >
            💥 Події ({impacts.length})
          </button>
          <button
            type="button"
            className={`tactical-nav-item ${activeTab === "intel" ? "active" : ""}`}
            onClick={() => setActiveTab("intel")}
          >
            🤖 Інтел
          </button>
        </div>

        {/* Content Container */}
        <div className="tactical-menu-content">
          {/* TAB 1: TARGETS */}
          {activeTab === "targets" && (
            <div className="tactical-tab-pane">
              <div className="tactical-section-title">ФІЛЬТРАЦІЯ ТА СЕЛЕКЦІЯ ПОВІТРЯНИХ ЦІЛЕЙ</div>

              <div className="tactical-filter-grid">
                <button
                  type="button"
                  className={`tactical-filter-btn ${filters.uav ? "active-uav" : "inactive"}`}
                  onClick={() => onToggleFilter("uav")}
                >
                  <span className="filter-sym">🔴</span>
                  <span className="filter-name">БПЛА (Shahed/Розвідка)</span>
                  <span className="filter-count">{uavCount}</span>
                </button>

                <button
                  type="button"
                  className={`tactical-filter-btn ${filters.munition ? "active-munition" : "inactive"}`}
                  onClick={() => onToggleFilter("munition")}
                >
                  <span className="filter-sym">🟠</span>
                  <span className="filter-name">Крилаті / Балістичні ракети</span>
                  <span className="filter-count">{munitionCount}</span>
                </button>

                <button
                  type="button"
                  className={`tactical-filter-btn ${filters.bomb ? "active-bomb" : "inactive"}`}
                  onClick={() => onToggleFilter("bomb")}
                >
                  <span className="filter-sym">💣</span>
                  <span className="filter-name">КАБ (УМПК / Авіабомби)</span>
                  <span className="filter-count">{bombCount}</span>
                </button>

                <button
                  type="button"
                  className={`tactical-filter-btn ${filters.fpv ? "active-fpv" : "inactive"}`}
                  onClick={() => onToggleFilter("fpv")}
                >
                  <span className="filter-sym">🟣</span>
                  <span className="filter-name">FPV-дрони (Ударні)</span>
                  <span className="filter-count">{fpvCount}</span>
                </button>

                <button
                  type="button"
                  className={`tactical-filter-btn ${filters.aircraft ? "active-aircraft" : "inactive"}`}
                  onClick={() => onToggleFilter("aircraft")}
                >
                  <span className="filter-sym">🔵</span>
                  <span className="filter-name">Авіація (Борти / ADS-B)</span>
                  <span className="filter-count">{aircraftCount}</span>
                </button>

                <button
                  type="button"
                  className={`tactical-filter-btn ${filters.helicopter ? "active-helo" : "inactive"}`}
                  onClick={() => onToggleFilter("helicopter")}
                >
                  <span className="filter-sym">🟢</span>
                  <span className="filter-name">Вертольоти</span>
                  <span className="filter-count">{heloCount}</span>
                </button>
              </div>

              <div className="tactical-toggle-row">
                <div>
                  <div className="toggle-label-main">⚠️ Фільтр: Тільки загрози Україні</div>
                  <div className="toggle-label-sub">Приховувати транзитні цивільні рейси над країнами ЄС</div>
                </div>
                <button
                  type="button"
                  className={`toggle-switch ${threatOnly ? "on" : "off"}`}
                  onClick={onToggleThreatOnly}
                >
                  <span className="switch-knob" />
                </button>
              </div>

              <div className="tactical-action-box">
                <button
                  type="button"
                  className="tactical-primary-btn"
                  onClick={() => {
                    onFitAllTargets();
                    onClose();
                  }}
                >
                  🎯 Сфокусувати всі {totalTrackCount} цілей на карті
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: VISION */}
          {activeTab === "vision" && (
            <div className="tactical-tab-pane">
              <div className="tactical-section-title">СПЕКТРАЛЬНІ РЕЖИМИ ОПТИКИ ТА СУПУТНИКА</div>

              <div className="vision-cards-grid">
                <div
                  className={`vision-card ${visionMode === "satellite" ? "selected" : ""}`}
                  onClick={() => onSelectVision("satellite")}
                >
                  <div className="vision-card-header">
                    <span className="vision-icon">🛰️</span>
                    <strong className="vision-name">Google Satellite HD</strong>
                  </div>
                  <div className="vision-desc">
                    Високодеталізована супутникова зйомка без обмежень та без водяних знаків.
                  </div>
                </div>

                <div
                  className={`vision-card ${visionMode === "nvg" ? "selected" : ""}`}
                  onClick={() => onSelectVision("nvg")}
                >
                  <div className="vision-card-header">
                    <span className="vision-icon">🟢</span>
                    <strong className="vision-name">NVG Нічне бачення</strong>
                  </div>
                  <div className="vision-desc">
                    Тактичний зелений спектр посилення залишкового світла з векторним оверлеєм.
                  </div>
                </div>

                <div
                  className={`vision-card ${visionMode === "flir" ? "selected" : ""}`}
                  onClick={() => onSelectVision("flir")}
                >
                  <div className="vision-card-header">
                    <span className="vision-icon">🔥</span>
                    <strong className="vision-name">FLIR Тепловізор</strong>
                  </div>
                  <div className="vision-desc">
                    Контрастний тепловий спектр (White Hot) для виявлення теплових сигнатур.
                  </div>
                </div>

                <div
                  className={`vision-card ${visionMode === "tactical" ? "selected" : ""}`}
                  onClick={() => onSelectVision("tactical")}
                >
                  <div className="vision-card-header">
                    <span className="vision-icon">🗺️</span>
                    <strong className="vision-name">Тактичний вектор</strong>
                  </div>
                  <div className="vision-desc">
                    Темна мінімалістична картографічна сітка без зайвих деталей рельєфу.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: LAYERS */}
          {activeTab === "layers" && (
            <div className="tactical-tab-pane">
              <div className="tactical-section-title">ТАКТИЧНІ ОВЕРЛЕЇ ТА ДОДАТКОВІ ШАРИ</div>

              <div className="tactical-toggle-row">
                <div>
                  <div className="toggle-label-main">🌦️ Метеорадар опадів (RainViewer)</div>
                  <div className="toggle-label-sub">Відображає хмари, грозові фронти та дощ у реальному часі</div>
                </div>
                <button
                  type="button"
                  className={`toggle-switch ${showWeather ? "on" : "off"}`}
                  onClick={onToggleWeather}
                >
                  <span className="switch-knob" />
                </button>
              </div>

              <div className="tactical-toggle-row">
                <div>
                  <div className="toggle-label-main">⚔️ Лінія бойового зіткнення (Фронт / ЛБЗ)</div>
                  <div className="toggle-label-sub">Оперативна лінія бойових дій та активні рубежі оборони</div>
                </div>
                <button
                  type="button"
                  className={`toggle-switch ${showFrontline ? "on" : "off"}`}
                  onClick={onToggleFrontline}
                >
                  <span className="switch-knob" />
                </button>
              </div>

              <div className="tactical-toggle-row">
                <div>
                  <div className="toggle-label-main">🛰️ Орбітальні розвідсупутники НАТО</div>
                  <div className="toggle-label-sub">Розрахунок орбіт оптичних та SAR супутників над Україною</div>
                </div>
                <button
                  type="button"
                  className={`toggle-switch ${showSatellites ? "on" : "off"}`}
                  onClick={onToggleSatellites}
                >
                  <span className="switch-knob" />
                </button>
              </div>

              <div className="tactical-toggle-row">
                <div>
                  <div className="toggle-label-main">🔊 Тактичні звукові сигнали тривоги</div>
                  <div className="toggle-label-sub">Акустичний пінґ при вході загрози в радіус 25 км</div>
                </div>
                <button
                  type="button"
                  className={`toggle-switch ${soundEnabled ? "on" : "off"}`}
                  onClick={onToggleSound}
                >
                  <span className="switch-knob" />
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: CITIES & GPS */}
          {activeTab === "cities" && (
            <div className="tactical-tab-pane">
              <div className="tactical-section-title">ПОЗИЦІОНУВАННЯ ТА ШВИДКИЙ ПЕРЕХІД ДО МІСТ</div>

              <div className="gps-control-card">
                <div className="gps-card-info">
                  <span className="gps-icon">📍</span>
                  <div>
                    <div className="gps-title">
                      {isManual ? "Власна точка (Вручну)" : "GPS Навігація пристрою"}
                    </div>
                    <div className="gps-sub">
                      {location ? `${location.lat.toFixed(3)}°N, ${location.lon.toFixed(3)}°E` : "Очікування координат..."}
                    </div>
                  </div>
                </div>
                <div className="gps-card-actions">
                  <button
                    type="button"
                    className="tactical-sub-btn"
                    onClick={() => {
                      onResetGps();
                      onClose();
                    }}
                  >
                    📍 Моє GPS
                  </button>
                  <button
                    type="button"
                    className={`tactical-sub-btn ${isPickingLocation ? "btn-active" : ""}`}
                    onClick={() => {
                      onTogglePickLocation();
                      onClose();
                    }}
                  >
                    🗺️ Точка на карті
                  </button>
                </div>
              </div>

              <div className="tactical-section-title" style={{ marginTop: 14 }}>
                ШВИДКИЙ ПЕРЕХІД ДО СТРАТЕГІЧНИХ МІСТ:
              </div>

              <div className="cities-chips-grid">
                {LOCATIONS.map((loc) => {
                  const isAlarmed = activeAlerts.some((a) => a.toLowerCase().includes(loc.region.toLowerCase().replace("обл.", "").replace("область", "").trim()));
                  return (
                    <button
                      key={loc.name}
                      type="button"
                      className={`city-chip ${isAlarmed ? "city-chip-alarm" : ""}`}
                      onClick={() => {
                        onSelectCity(loc.lat, loc.lon, loc.name, loc.zoom || 10.0);
                        onClose();
                      }}
                    >
                      <span className="city-chip-name">{loc.name}</span>
                      {isAlarmed && <span className="city-chip-beacon">🚨</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 5: IMPACTS & INTERCEPTIONS */}
          {activeTab === "impacts" && (
            <div className="tactical-tab-pane">
              <div className="tactical-section-title">ХРОНОЛОГІЯ ЗАФІКСОВАНИХ ПРИЛЬОТІВ ТА ЗБИТТЯ</div>

              {impacts.length === 0 ? (
                <div className="empty-state-box">
                  <span className="empty-icon">🛡️</span>
                  <div className="empty-title">Активних прильотів або збиття не зафіксовано</div>
                  <div className="empty-desc">
                    Система веде безперервний акустичний, супутниковий та радарний моніторинг повітряного простору.
                  </div>
                </div>
              ) : (
                <div className="impacts-list">
                  {impacts.map((evt) => {
                    const isImpact = evt.type === "impact";
                    return (
                      <div
                        key={evt.id}
                        className={`impact-item-card ${isImpact ? "item-impact" : "item-intercept"}`}
                        onClick={() => {
                          onFlyToCoord(evt.lat, evt.lon);
                          onClose();
                        }}
                      >
                        <div className="impact-item-header">
                          <span className="impact-icon">{isImpact ? "💥" : "🛡️"}</span>
                          <strong className="impact-type-label">
                            {isImpact ? "ПРИЛІТ / ДЕТОНАЦІЯ" : "ЗБИТТЯ ППО"}
                          </strong>
                          <span className="impact-time">{formatTimeAgo(evt.timestamp)}</span>
                        </div>
                        <div className="impact-item-body">
                          <div className="impact-model">
                            Ціль: <strong>{evt.targetModel}</strong>
                          </div>
                          <div className="impact-region">Регіон: {evt.region}</div>
                          {evt.details && <div className="impact-details">{evt.details}</div>}
                        </div>
                        <div className="impact-action-hint">
                          🔍 Натисніть для переходу на карті ({evt.lat.toFixed(2)}°N, {evt.lon.toFixed(2)}°E)
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 6: INTEL & DIAGNOSTICS */}
          {activeTab === "intel" && (
            <div className="tactical-tab-pane">
              <div className="tactical-section-title">AI-АНАЛІТИКА ТА ДІАГНОСТИКА СЕНСОРІВ</div>

              <div className="intel-actions-box">
                <button
                  type="button"
                  className="tactical-primary-btn"
                  style={{ background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)" }}
                  onClick={() => {
                    onOpenBriefing();
                    onClose();
                  }}
                >
                  🤖 Запустити тактичний AI-Брифінг
                </button>

                <button
                  type="button"
                  className="tactical-primary-btn"
                  style={{ background: "linear-gradient(135deg, #b45309 0%, #d97706 100%)", marginTop: 8 }}
                  onClick={() => {
                    onOpenReport();
                    onClose();
                  }}
                >
                  📢 Подати рапорт очевидця (Проліт / Вибух)
                </button>
              </div>

              <div className="tactical-section-title" style={{ marginTop: 16 }}>
                СТАТУС ПІДКЛЮЧЕНИХ ДЖЕРЕЛ ДАНИХ:
              </div>

              <div className="sensors-status-grid">
                <div className="sensor-card">
                  <div className="sensor-name">alerts.in.ua (Сирени)</div>
                  <div className="sensor-status online">🟢 ОФІЦІЙНО ОНЛАЙН</div>
                </div>
                <div className="sensor-card">
                  <div className="sensor-name">airplanes.live (ADS-B)</div>
                  <div className="sensor-status online">🟢 ТРАНСЛЯЦІЯ АКТИВНА</div>
                </div>
                <div className="sensor-card">
                  <div className="sensor-name">NASA FIRMS (Тепловізія)</div>
                  <div className="sensor-status online">🟢 СУПУТНИКОВИЙ МОНІТОРИНГ</div>
                </div>
                <div className="sensor-card">
                  <div className="sensor-name">RainViewer (Метео)</div>
                  <div className="sensor-status online">🟢 СИНХРОНІЗОВАНО</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
