import { useState } from "react";
import type { TrustedLocation } from "../location/useTrustedLocation";

export interface TacticalFilters {
  autoTracking: boolean;
  minSpeedKmh: number;
  maxSpeedKmh: number;
  threatOnly: boolean;
  dangerRadiusKm: number;
  showWind: boolean;
}

interface TacticalParamsModalProps {
  isOpen: boolean;
  onClose: () => void;
  filters: TacticalFilters;
  onChangeFilters: (filters: TacticalFilters) => void;
  location: TrustedLocation | null;
}

export const TacticalParamsModal = ({
  isOpen,
  onClose,
  filters,
  onChangeFilters,
  location
}: TacticalParamsModalProps) => {
  const [drillType, setDrillType] = useState<"uav" | "munition">("uav");
  const [drillTargetCity, setDrillTargetCity] = useState("Київ");
  const [injecting, setInjecting] = useState(false);
  const [drillStatus, setDrillStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const triggerHaptic = (type: "light" | "medium" | "heavy" = "light") => {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(type);
    } catch {}
  };

  const handleLaunchDrill = async () => {
    triggerHaptic("heavy");
    setInjecting(true);
    setDrillStatus(null);

    // Target coordinates by city
    const cityCoords: Record<string, { lat: number; lon: number; startLat: number; startLon: number; heading: number }> = {
      Київ: { lat: 50.4501, lon: 30.5234, startLat: 51.8, startLon: 31.2, heading: 195 },
      Харків: { lat: 49.9935, lon: 36.2304, startLat: 50.6, startLon: 37.0, heading: 220 },
      Одеса: { lat: 46.4825, lon: 30.7233, startLat: 45.4, startLon: 31.8, heading: 315 },
      Дніпро: { lat: 48.4647, lon: 35.0462, startLat: 47.6, startLon: 36.5, heading: 330 },
      Львів: { lat: 49.8397, lon: 24.0297, startLat: 50.7, startLon: 25.5, heading: 240 }
    };

    const target = cityCoords[drillTargetCity] ?? cityCoords["Київ"];
    const speed = drillType === "uav" ? 185 : 820;

    try {
      const res = await fetch("/api/drill/inject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: drillType,
          lat: target.startLat,
          lon: target.startLon,
          heading: target.heading,
          speed,
          label: `Навчальна: ${drillType === "uav" ? "Shahed-136" : "Калібр"} -> ${drillTargetCity}`
        })
      });

      if (res.ok) {
        setDrillStatus(`✅ Ціль запущено: сектор ${drillTargetCity}! Перевірте радар.`);
      } else {
        setDrillStatus("⚠️ Помилка створення цілі.");
      }
    } catch {
      setDrillStatus("⚠️ Мережева помилка.");
    } finally {
      setInjecting(false);
    }
  };

  return (
    <div className="briefing-overlay" onClick={onClose}>
      <div className="briefing-card tactical-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="briefing-header">
          <div className="briefing-title">
            <span className="briefing-icon">⚙️</span>
            <span>ТАКТИЧНІ ПАРАМЕТРИ ТА АВТОМАТИКА</span>
          </div>
          <button className="briefing-close" onClick={onClose}>✕</button>
        </div>

        <div className="briefing-body">
          {/* 1. Operation Mode: Auto Sentinel vs Manual */}
          <div className="param-section">
            <label className="param-title">РЕЖИМ СУПРОВОДЖЕННЯ</label>
            <div className="param-toggle-group">
              <button
                className={`param-toggle-btn ${filters.autoTracking ? "active" : ""}`}
                onClick={() => {
                  triggerHaptic("medium");
                  onChangeFilters({ ...filters, autoTracking: true });
                }}
              >
                ⚡ АВТО-СЕНТИНЕЛ
              </button>
              <button
                className={`param-toggle-btn ${!filters.autoTracking ? "active" : ""}`}
                onClick={() => {
                  triggerHaptic("medium");
                  onChangeFilters({ ...filters, autoTracking: false });
                }}
              >
                🕹️ РУЧНИЙ ОГЛЯД
              </button>
            </div>
            <span className="param-desc">
              {filters.autoTracking
                ? "Автоматичне захоплення та наведення камери на найближчу небезпечну ціль."
                : "Вільне керування картою без автоматичного фокусування."}
            </span>
          </div>

          {/* 2. Speed Range Filter */}
          <div className="param-section">
            <div className="param-title-row">
              <label className="param-title">ШВИДКІСТЬ ЦІЛЕЙ (КМ/ГОД)</label>
              <span className="param-value-tag">
                {filters.minSpeedKmh} – {filters.maxSpeedKmh >= 1500 ? "1500+ км/год" : `${filters.maxSpeedKmh} км/год`}
              </span>
            </div>

            <div className="slider-row">
              <input
                type="range"
                min="0"
                max="1200"
                step="50"
                value={filters.minSpeedKmh}
                onChange={(e) => {
                  onChangeFilters({ ...filters, minSpeedKmh: Number(e.target.value) });
                }}
              />
            </div>

            <div className="presets-row">
              <button
                className="preset-chip"
                onClick={() => {
                  triggerHaptic();
                  onChangeFilters({ ...filters, minSpeedKmh: 0, maxSpeedKmh: 2500 });
                }}
              >
                Всі швидкості
              </button>
              <button
                className="preset-chip"
                onClick={() => {
                  triggerHaptic();
                  onChangeFilters({ ...filters, minSpeedKmh: 90, maxSpeedKmh: 320 });
                }}
              >
                Тільки БПЛА (90-320)
              </button>
              <button
                className="preset-chip"
                onClick={() => {
                  triggerHaptic();
                  onChangeFilters({ ...filters, minSpeedKmh: 500, maxSpeedKmh: 2500 });
                }}
              >
                Тільки Ракети (&gt;500)
              </button>
            </div>
          </div>

          {/* 3. Personal Danger Radius */}
          <div className="param-section">
            <div className="param-title-row">
              <label className="param-title">РАДІУС ЗОНИ ЗАГРОЗИ</label>
              <span className="param-value-tag">{filters.dangerRadiusKm} км</span>
            </div>
            <input
              type="range"
              min="10"
              max="120"
              step="5"
              value={filters.dangerRadiusKm}
              onChange={(e) => {
                onChangeFilters({ ...filters, dangerRadiusKm: Number(e.target.value) });
              }}
            />
          </div>

          {/* 4. Filter Threat Only & Wind */}
          <div className="param-section">
            <label className="param-title">ДОДАТКОВІ ШАРИ ДАНИХ</label>
            <div className="toggles-grid">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={filters.threatOnly}
                  onChange={(e) => {
                    triggerHaptic();
                    onChangeFilters({ ...filters, threatOnly: e.target.checked });
                  }}
                />
                <span>Тільки реальні загрози (БПЛА/Ракети)</span>
              </label>

              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={filters.showWind}
                  onChange={(e) => {
                    triggerHaptic();
                    onChangeFilters({ ...filters, showWind: e.target.checked });
                  }}
                />
                <span>Вітровий шар зносу (Open-Meteo)</span>
              </label>
            </div>
          </div>

          {/* 5. Drill Simulator Injector */}
          <div className="param-section drill-box">
            <label className="param-title" style={{ color: "#f59e0b" }}>
              🎯 НАВЧАЛЬНИЙ СИМУЛЯТОР ЦИВІЛЬНОЇ ОБОРОНИ
            </label>
            <span className="param-desc">Запустіть тренувальну ціль для перевірки реакції та розрахунку ETA:</span>

            <div className="drill-controls">
              <select
                value={drillType}
                onChange={(e) => setDrillType(e.target.value as "uav" | "munition")}
                className="drill-select"
              >
                <option value="uav">БПЛА Shahed-136 (185 км/год)</option>
                <option value="munition">Крилата ракета Калібр (820 км/год)</option>
              </select>

              <select
                value={drillTargetCity}
                onChange={(e) => setDrillTargetCity(e.target.value)}
                className="drill-select"
              >
                <option value="Київ">Курс: Київ</option>
                <option value="Харків">Курс: Харків</option>
                <option value="Одеса">Курс: Одеса</option>
                <option value="Дніпро">Курс: Дніпро</option>
                <option value="Львів">Курс: Львів</option>
              </select>

              <button
                className="drill-launch-btn"
                onClick={handleLaunchDrill}
                disabled={injecting}
              >
                {injecting ? "Запуск..." : "🚀 Запустити навчальну ціль"}
              </button>
            </div>

            {drillStatus && <div className="drill-feedback">{drillStatus}</div>}
          </div>
        </div>

        <div className="briefing-footer">
          <button className="briefing-action-btn" onClick={onClose}>
            ЗАСТОСУВАТИ ТА ПОВЕРНУТИСЬ НА КАРТУ
          </button>
        </div>
      </div>
    </div>
  );
};
