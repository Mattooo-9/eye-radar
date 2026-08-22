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
      <span className="status-label">WS</span>
      <strong>{connectionState}</strong>
    </div>
    <div className="status-card">
      <span className="status-label">Tracks</span>
      <strong>{trackCount}</strong>
    </div>
    <div className="status-card">
      <span className="status-label">Trust</span>
      <strong>{trustScore}%</strong>
    </div>
    <div className="status-flags">
      {flags.length > 0 ? flags.join(", ") : "anomaly: none"}
    </div>
  </aside>
);
