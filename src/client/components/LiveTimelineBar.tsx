import React from "react";
import type { SolarMode } from "./MapView";

export type PerformanceTier = "LOW" | "NORMAL" | "HIGH";

interface LiveTimelineBarProps {
  selectedOffsetSec: number;
  onSelectOffset: (offsetSec: number) => void;
  performanceTier: PerformanceTier;
  onSelectTier: (tier: PerformanceTier) => void;
  solarMode?: SolarMode;
  onSelectSolarMode?: (mode: SolarMode) => void;
}

const TIMELINE_STEPS = [
  { label: "НАЖИВО", offsetSec: 0, title: "Поточний стан у реальному часі" },
  { label: "5 хв", offsetSec: 300, title: "5 хвилин тому" },
  { label: "10 хв", offsetSec: 600, title: "10 хвилин тому" },
  { label: "30 хв", offsetSec: 1800, title: "30 хвилин тому" },
  { label: "60 хв", offsetSec: 3600, title: "60 хвилин тому" }
];

const TIER_LABELS: Record<PerformanceTier, string> = {
  LOW: "ЕКО",
  NORMAL: "БАЛАНС",
  HIGH: "МАКС"
};

const SOLAR_LABELS: Record<SolarMode, string> = {
  auto: "🌓 АВТО",
  day: "☀️ ДЕНЬ",
  night: "🌙 НІЧ"
};

export const LiveTimelineBar: React.FC<LiveTimelineBarProps> = ({
  selectedOffsetSec,
  onSelectOffset,
  performanceTier,
  onSelectTier,
  solarMode = "auto",
  onSelectSolarMode
}) => {
  const triggerHaptic = () => {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
    } catch {}
  };

  const cycleTier = () => {
    triggerHaptic();
    const next: PerformanceTier =
      performanceTier === "LOW" ? "NORMAL" : performanceTier === "NORMAL" ? "HIGH" : "LOW";
    onSelectTier(next);
  };

  const cycleSolarMode = () => {
    if (!onSelectSolarMode) return;
    triggerHaptic();
    const next: SolarMode =
      solarMode === "auto" ? "day" : solarMode === "day" ? "night" : "auto";
    onSelectSolarMode(next);
  };

  return (
    <div className="live-timeline-container">
      {selectedOffsetSec > 0 && (
        <div className="timeline-historical-banner">
          <span>⏳ ІСТОРІЯ: -{Math.round(selectedOffsetSec / 60)} ХВ</span>
          <button
            type="button"
            className="timeline-return-live-btn"
            onClick={() => {
              triggerHaptic();
              onSelectOffset(0);
            }}
          >
            ● ПОВЕРНУТИСЬ НАЖИВО
          </button>
        </div>
      )}

      <div className="timeline-bar">
        <div className="timeline-steps">
          {TIMELINE_STEPS.map((step) => {
            const isActive = selectedOffsetSec === step.offsetSec;
            return (
              <button
                key={step.offsetSec}
                type="button"
                className={`timeline-step-btn ${isActive ? "active" : ""} ${step.offsetSec === 0 ? "live-btn" : ""}`}
                onClick={() => {
                  triggerHaptic();
                  onSelectOffset(step.offsetSec);
                }}
                title={step.title}
              >
                {step.label}
              </button>
            );
          })}
        </div>

        {onSelectSolarMode && (
          <button
            type="button"
            className="timeline-tier-badge"
            onClick={cycleSolarMode}
            title="Режим освітлення карти (Авто за Сонцем / День / Ніч). Натисніть для перемикання."
          >
            {SOLAR_LABELS[solarMode]}
          </button>
        )}

        <button
          type="button"
          className={`timeline-tier-badge tier-${performanceTier.toLowerCase()}`}
          onClick={cycleTier}
          title={`Режим графіки: ${TIER_LABELS[performanceTier]}. Натисніть для зміни.`}
        >
          ⚡ {TIER_LABELS[performanceTier]}
        </button>
      </div>
    </div>
  );
};
