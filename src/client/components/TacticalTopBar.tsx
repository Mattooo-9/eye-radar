import React from "react";
import type { AlertFeedStatus } from "../types";

interface TacticalTopBarProps {
  threatCount: number;
  totalTracksCount?: number;
  activeAlertsCount: number;
  alertStatus?: AlertFeedStatus;
  alertsUpdatedAt?: number | null;
  uncertaintyCount?: number;
  connectionState?: "idle" | "connecting" | "open" | "closed";
  onOpenMenu: () => void;
  onOpenReport: () => void;
  onOpenAlerts: () => void;
}

const formatShortTime = (ts: number | null | undefined): string => {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

export const TacticalTopBar: React.FC<TacticalTopBarProps> = ({
  threatCount,
  totalTracksCount,
  activeAlertsCount,
  alertStatus = "unavailable",
  alertsUpdatedAt = null,
  uncertaintyCount: _uncertaintyCount = 0,
  connectionState = "open",
  onOpenMenu,
  onOpenReport,
  onOpenAlerts
}) => {
  const isLiveWs = connectionState === "open";
  const timeLabel = formatShortTime(alertsUpdatedAt);

  return (
    <header className="tactical-top-bar">
      <div className="top-bar-left" onClick={onOpenMenu} title="Натисніть для відкриття тактичного меню">
        <img src="/avatar.jpg" alt="Eye Radar" className="top-bar-avatar" />
        <div className="top-bar-brand">
          <span className="brand-text">EYE RADAR</span>
          <span className={`live-status-pill ${isLiveWs ? "ws-open" : "ws-sync"}`}>
            <span className="live-dot" />
            <span className="live-text">{isLiveWs ? "ОНЛАЙН" : "ЗВ'ЯЗОК"}</span>
          </span>
        </div>
      </div>

      <div className="top-bar-center">
        {alertStatus === "unavailable" ? (
          <button
            type="button"
            className="top-bar-alert-pill alert-stale"
            onClick={onOpenAlerts}
            title="Немає зв'язку з джерелом тривог — поточний стан невідомий (це НЕ відбій)"
          >
            <span className="alert-pill-text">
              ⚠ ТРИВОГИ: НЕВІДОМО <span className="alert-pill-chevron">▼</span>
            </span>
          </button>
        ) : alertStatus === "stale" ? (
          <button
            type="button"
            className="top-bar-alert-pill alert-stale"
            onClick={onOpenAlerts}
            title={`Втрачено зв'язок із джерелом тривог — це НЕ відбій. Останній підтверджений стан${timeLabel ? ` о ${timeLabel}` : ""}.`}
          >
            <span className="alert-pill-text">
              ⚠ {activeAlertsCount > 0 ? `НЕ ОНОВЛЕНО (${activeAlertsCount} ОБЛ.)` : "СТАН НЕВІДОМИЙ"}
              <span className="alert-pill-chevron"> ▼</span>
            </span>
          </button>
        ) : activeAlertsCount > 0 ? (
          <button
            type="button"
            className="top-bar-alert-pill"
            onClick={onOpenAlerts}
            title={`Офіційні повітряні тривоги (${activeAlertsCount} обл.)${timeLabel ? ` · підтверджено ${timeLabel}` : ""}`}
          >
            <span className="alert-pill-text">
              ТРИВОГА: {activeAlertsCount} ОБЛ. <span className="alert-pill-chevron">▼</span>
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="top-bar-calm-pill"
            onClick={onOpenAlerts}
            title={`Офіційних тривог не оголошено${timeLabel ? ` · підтверджено ${timeLabel}` : ""}`}
          >
            <span className="calm-text">НЕБО СПОКІЙНЕ</span>
          </button>
        )}
      </div>

      <div className="top-bar-right">
        <button
          type="button"
          className="top-bar-report-btn"
          onClick={onOpenReport}
          title="Подати екстрений рапорт очевидця про звук або проліт цілі"
        >
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
          <span className={`menu-count-badge ${threatCount > 0 ? "has-threats" : ""}`}>
            {threatCount > 0 ? threatCount : (totalTracksCount ?? 0)}
          </span>
          <span className="menu-chevron">▼</span>
        </button>
      </div>
    </header>
  );
};
