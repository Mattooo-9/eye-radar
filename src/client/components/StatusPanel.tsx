interface StatusPanelProps {
  trackCount: number;
  connectionState: string;
  trustScore: number;
  flags: string[];
}

export const StatusPanel = ({
  trackCount,
  connectionState,
  trustScore,
  flags
}: StatusPanelProps) => (
  <aside className="status-panel">
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
  </aside>
);
