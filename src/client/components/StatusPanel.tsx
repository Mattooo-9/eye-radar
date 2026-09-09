export interface FilterState {
  uav: boolean;
  munition: boolean;
  aircraft: boolean;
  sound: boolean;
}

interface StatusPanelProps {
  trackCount: number;
  connectionState: string;
  trustScore: number;
  flags: string[];
  filters: FilterState;
  onToggleFilter: (key: keyof FilterState) => void;
}

export const StatusPanel = ({
  trackCount,
  connectionState,
  trustScore,
  flags,
  filters,
  onToggleFilter
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
    </div>

    <div className="filter-chips">
      <button
        className={`filter-chip ${filters.uav ? "active-uav" : "inactive"}`}
        onClick={() => onToggleFilter("uav")}
      >
        🔴 БПЛА
      </button>
      <button
        className={`filter-chip ${filters.munition ? "active-munition" : "inactive"}`}
        onClick={() => onToggleFilter("munition")}
      >
        🟠 Ракети
      </button>
      <button
        className={`filter-chip ${filters.aircraft ? "active-aircraft" : "inactive"}`}
        onClick={() => onToggleFilter("aircraft")}
      >
        🔵 Авіація
      </button>
      <button
        className={`filter-chip ${filters.sound ? "active-sound" : "inactive"}`}
        onClick={() => onToggleFilter("sound")}
      >
        {filters.sound ? "🔔 Звук ВКЛ" : "🔕 Звук ВИКЛ"}
      </button>
    </div>
  </aside>
);
