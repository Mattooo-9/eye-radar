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
  onChangeFilters
}: TacticalParamsModalProps) => {
  if (!isOpen) return null;

  const triggerHaptic = (type: "light" | "medium" | "heavy" = "light") => {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(type);
    } catch {}
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
