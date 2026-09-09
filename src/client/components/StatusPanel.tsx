export interface FilterState {
  uav: boolean;
  munition: boolean;
  aircraft: boolean;
  helicopter?: boolean;
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
  aircraftCount?: number;
  heloCount?: number;
  onFitAllTargets?: () => void;
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
  aircraftCount = 0,
  heloCount = 0,
  onFitAllTargets
}: StatusPanelProps) => (
  <aside className="status-panel">
    <div className="status-row">
      <div className="status-card">
        <span className="status-label">РАДАР</span>
        <strong className={connectionState === "open" ? "status-online" : "status-offline"}>
          {connectionState === "open" ? "LIVE" : connectionState.toUpperCase()}
        </strong>
      </div>
      <div className="status-card">
        <span className="status-label">ЦІЛІ</span>
        <strong className={trackCount > 0 ? "threat-count" : ""}>{trackCount}</strong>
      </div>
      <div className="status-card">
        <span className="status-label">GPS ДОВІРА</span>
        <strong className={trustScore < 60 ? "trust-low" : "trust-ok"}>{trustScore}%</strong>
      </div>
      <div className="status-flags">
        {flags.length > 0 ? `⚠️ ${flags.join(", ")}` : "🛡️ GPS норма"}
      </div>
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

    <div className="filter-chips">
      <button
        className={`filter-chip ${filters.uav ? "active-uav" : "inactive"}`}
        onClick={() => onToggleFilter("uav")}
        title="Фільтр БПЛА (Шахеди/розвідники)"
      >
        🔴 БПЛА ({uavCount})
      </button>
      <button
        className={`filter-chip ${filters.munition ? "active-munition" : "inactive"}`}
        onClick={() => onToggleFilter("munition")}
        title="Фільтр крилатих та балістичних ракет"
      >
        🟠 Ракети ({munitionCount})
      </button>
      <button
        className={`filter-chip ${filters.aircraft ? "active-aircraft" : "inactive"}`}
        onClick={() => onToggleFilter("aircraft")}
        title="Фільтр бойової та тактичної авіації"
      >
        🔵 Авіація ({aircraftCount})
      </button>
      {filters.helicopter !== undefined && (
        <button
          className={`filter-chip ${filters.helicopter ? "active-helo" : "inactive"}`}
          onClick={() => onToggleFilter("helicopter")}
          title="Фільтр військових гелікоптерів"
        >
          🟢 Вертольоти ({heloCount})
        </button>
      )}
      <button
        className={`filter-chip ${filters.sound ? "active-sound" : "inactive"}`}
        onClick={() => onToggleFilter("sound")}
      >
        {filters.sound ? "🔔 Звук" : "🔕 Звук"}
      </button>
    </div>
  </aside>
);
