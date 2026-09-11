import React from "react";
import type { ImpactEvent } from "../hooks/useWsRadar";

interface ImpactCardProps {
  event: ImpactEvent;
  onClose: () => void;
  onCenter: (lat: number, lon: number) => void;
}

export const ImpactCard: React.FC<ImpactCardProps> = ({ event, onClose, onCenter }) => {
  const isImpact = event.type === "impact";
  const dateStr = new Date(event.timestamp).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  return (
    <div className={`impact-card ${isImpact ? "impact-card-red" : "impact-card-cyan"}`}>
      <div className="impact-card-header">
        <div className="impact-card-title-group">
          <div>
            <div className="impact-card-headline">
              {isImpact ? "ЗАФІКСОВАНО ПРИЛІТ / ВИБУХ" : "УСПІШНЕ ПЕРЕХОПЛЕННЯ ППО"}
            </div>
            <div className="impact-card-sub">Фіксація: {dateStr}</div>
          </div>
        </div>
        <button type="button" className="impact-card-close" onClick={onClose} aria-label="Закрити">
          ✕
        </button>
      </div>

      <div className="impact-card-body">
        <div className="impact-prop-row">
          <span className="prop-label">Тип загрози:</span>
          <span className="prop-val">{event.targetModel}</span>
        </div>
        <div className="impact-prop-row">
          <span className="prop-label">Регіон:</span>
          <span className="prop-val">{event.region}</span>
        </div>
        <div className="impact-prop-row">
          <span className="prop-label">Координати:</span>
          <span className="prop-val mono">
            {event.lat.toFixed(4)}°N, {event.lon.toFixed(4)}°E
          </span>
        </div>
        {event.details && (
          <div className="impact-details-box">
            <span className="details-tag">Оперативна інформація:</span>
            <p className="details-text">{event.details}</p>
          </div>
        )}
      </div>

      <div className="impact-card-footer">
        <button
          type="button"
          className="impact-focus-btn"
          onClick={() => onCenter(event.lat, event.lon)}
        >
          Сфокусувати епіцентр
        </button>
      </div>
    </div>
  );
};
