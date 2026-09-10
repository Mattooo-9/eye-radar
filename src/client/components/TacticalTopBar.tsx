import React from "react";

interface TacticalTopBarProps {
  threatCount: number;
  activeAlertsCount: number;
  onOpenMenu: () => void;
  onOpenReport: () => void;
  onOpenAlerts: () => void;
}

export const TacticalTopBar: React.FC<TacticalTopBarProps> = ({
  threatCount,
  activeAlertsCount,
  onOpenMenu,
  onOpenReport,
  onOpenAlerts
}) => {
  return (
    <header className="tactical-top-bar">
      <div className="top-bar-left" onClick={onOpenMenu} title="Натисніть для відкриття тактичного меню">
        <img src="/avatar.jpg" alt="Eye Radar" className="top-bar-avatar" />
        <div className="top-bar-brand">
          <span className="brand-text">EYE RADAR</span>
          <span className="live-status-pill">
            <span className="live-dot" />
            <span className="live-text">LIVE</span>
          </span>
        </div>
      </div>

      <div className="top-bar-center">
        {activeAlertsCount > 0 ? (
          <button
            type="button"
            className="top-bar-alert-pill"
            onClick={onOpenAlerts}
            title="Натисніть для списку областей з повітряною тривогою"
          >
            <span className="alert-siren-anim">🚨</span>
            <span className="alert-pill-text">ТРИВОГА: {activeAlertsCount} ОБЛ. ▼</span>
          </button>
        ) : (
          <div className="top-bar-calm-pill">
            <span className="calm-shield">🛡️</span>
            <span className="calm-text">НЕБО СПОКІЙНЕ</span>
          </div>
        )}
      </div>

      <div className="top-bar-right">
        <button
          type="button"
          className="top-bar-report-btn"
          onClick={onOpenReport}
          title="Подати екстрений рапорт очевидця про звук або проліт цілі"
        >
          <span className="report-icon">📢</span>
          <span className="report-text">РАПОРТ</span>
        </button>

        <button
          type="button"
          className="top-bar-menu-btn"
          onClick={onOpenMenu}
          title="Відкрити тактичні опції, фільтри та налаштування"
        >
          <span className="menu-icon">☰</span>
          <span className="menu-text">ОПЦІЇ</span>
          <span className="menu-count-badge">{threatCount}</span>
          <span className="menu-chevron">▼</span>
        </button>
      </div>
    </header>
  );
};
