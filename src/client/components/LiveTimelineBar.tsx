import React from "react";

export type PerformanceTier = "LOW" | "NORMAL" | "HIGH";

interface LiveTimelineBarProps {
  selectedOffsetSec: number;
  onSelectOffset: (offsetSec: number) => void;
  performanceTier: PerformanceTier;
  onSelectTier: (tier: PerformanceTier) => void;
}

const TIMELINE_STEPS = [
  { label: "СЕЙЧАС", offsetSec: 0, title: "Реальний час спостереження (LIVE)" },
  { label: "5 хв", offsetSec: 300, title: "5 хвилин тому" },
  { label: "10 хв", offsetSec: 600, title: "10 хвилин тому" },
  { label: "30 хв", offsetSec: 1800, title: "30 хвилин тому" },
  { label: "60 хв", offsetSec: 3600, title: "60 хвилин тому" }
];

export const LiveTimelineBar: React.FC<LiveTimelineBarProps> = ({
  selectedOffsetSec,
  onSelectOffset,
  performanceTier,
  onSelectTier
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
            ● НАЗАД В LIVE
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

        <button
          type="button"
          className={`timeline-tier-badge tier-${performanceTier.toLowerCase()}`}
          onClick={cycleTier}
          title={`Режим оптимізації пристрою: ${performanceTier}. Натисніть для зміни.`}
        >
          ⚡ {performanceTier}
        </button>
      </div>
    </div>
  );
};
