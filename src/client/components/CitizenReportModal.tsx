import { useState } from "react";
import type { TrustedLocation } from "../location/useTrustedLocation";

interface CitizenReportModalProps {
  isOpen: boolean;
  location: TrustedLocation | null;
  trustScore?: number;
  onClose: () => void;
}

type ReportCategory = "uav_sound" | "munition_visual" | "explosion" | "visual";
type DirectionType = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export const CitizenReportModal = ({
  isOpen,
  location,
  trustScore = 95,
  onClose
}: CitizenReportModalProps) => {
  const [category, setCategory] = useState<ReportCategory>("uav_sound");
  const [direction, setDirection] = useState<DirectionType>("S");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const triggerHaptic = (style: "light" | "medium" | "heavy" = "light") => {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
    } catch {}
  };

  const handleSubmit = async () => {
    triggerHaptic("heavy");
    setSubmitting(true);
    setErrorMsg(null);

    const lat = location?.lat ?? 50.4501;
    const lon = location?.lon ?? 30.5234;

    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: category,
          lat,
          lon,
          direction,
          comment: comment.trim() || undefined
        })
      });

      if (!res.ok) {
        throw new Error("Сервер не зміг зберегти рапорт");
      }

      setSuccess(true);
      try {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      } catch {}

      setTimeout(() => {
        setSuccess(false);
        setSubmitting(false);
        setComment("");
        onClose();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err?.message || "Помилка передачі даних. Перевірте з'єднання.");
      setSubmitting(false);
    }
  };

  return (
    <div className="report-modal-overlay" onClick={onClose}>
      <div className="report-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="report-modal-header">
          <div className="report-title-group">
            <span className="report-header-icon">📢</span>
            <div>
              <h2 className="report-title">РАПОРТ СИТУАЦІЙНОЇ ОБІЗНАНОСТІ</h2>
              <span className="report-subtitle">
                Акустична та візуальна мережа виявлення загроз
              </span>
            </div>
          </div>
          <button
            type="button"
            className="report-close-btn"
            onClick={onClose}
            title="Закрити"
          >
            ✕
          </button>
        </div>

        {/* Success State Overlay */}
        {success ? (
          <div className="report-success-state">
            <div className="success-icon-pulsar">✓</div>
            <h3 className="success-title">РАПОРТ ПРИЙНЯТО!</h3>
            <p className="success-desc">
              Дані миттєво передано в ситуаційну сітку та зіставлено з радарними сенсорами.
            </p>
          </div>
        ) : (
          <div className="report-body">
            {/* Category selection */}
            <div className="report-section">
              <label className="section-label">1. Оберіть тип спостереження:</label>
              <div className="category-grid">
                <button
                  type="button"
                  className={`category-card ${category === "uav_sound" ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic();
                    setCategory("uav_sound");
                  }}
                >
                  <span className="cat-icon">🔊</span>
                  <div className="cat-info">
                    <strong className="cat-name">Звук «мопеда»</strong>
                    <span className="cat-sub">Двигун БПЛА Shahed / розвідник</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`category-card ${category === "munition_visual" ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic();
                    setCategory("munition_visual");
                  }}
                >
                  <span className="cat-icon">🚀</span>
                  <div className="cat-info">
                    <strong className="cat-name">Ракета / Свист</strong>
                    <span className="cat-sub">Реактивний низьковисотний звук</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`category-card ${category === "explosion" ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic();
                    setCategory("explosion");
                  }}
                >
                  <span className="cat-icon">💥</span>
                  <div className="cat-info">
                    <strong className="cat-name">Вибух / ППО</strong>
                    <span className="cat-sub">Акустичний вибух, перехоплення</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`category-card ${category === "visual" ? "active" : ""}`}
                  onClick={() => {
                    triggerHaptic();
                    setCategory("visual");
                  }}
                >
                  <span className="cat-icon">👁️</span>
                  <div className="cat-info">
                    <strong className="cat-name">Візуальний контакт</strong>
                    <span className="cat-sub">Пряме спостереження силуету в небі</span>
                  </div>
                </button>
              </div>
            </div>

            {/* Direction Selector */}
            <div className="report-section">
              <label className="section-label">2. Напрямок руху цілі (компас):</label>
              <div className="direction-pills-grid">
                {(
                  [
                    ["N", "⬆️ Північ (N)"],
                    ["NE", "↗️ Пн-Сх"],
                    ["E", "➡️ Схід (E)"],
                    ["SE", "↘️ Пд-Сх"],
                    ["S", "⬇️ Південь (S)"],
                    ["SW", "↙️ Пд-Зх"],
                    ["W", "⬅️ Захід (W)"],
                    ["NW", "↖️ Пн-Зх"]
                  ] as const
                ).map(([dirKey, label]) => (
                  <button
                    key={dirKey}
                    type="button"
                    className={`direction-pill ${direction === dirKey ? "active" : ""}`}
                    onClick={() => {
                      triggerHaptic();
                      setDirection(dirKey);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Location & Trust */}
            <div className="report-location-badge">
              <span className="loc-badge-icon">📍</span>
              <div className="loc-badge-text">
                <strong>
                  {location
                    ? `${location.lat.toFixed(4)}°N, ${location.lon.toFixed(4)}°E`
                    : "Автоматичні координати спостерігача"}
                </strong>
                <span className="loc-trust">
                  Захищений супутниковий GPS • Довіра {trustScore}%
                </span>
              </div>
            </div>

            {/* Optional Comment */}
            <div className="report-section">
              <label className="section-label">3. Додаткова інформація (орієнтири):</label>
              <input
                type="text"
                className="report-input"
                placeholder="Наприклад: летить низько вздовж русла річки..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={140}
              />
            </div>

            {errorMsg && <div className="report-error-msg">⚠️ {errorMsg}</div>}

            {/* Submit Button */}
            <div className="report-footer">
              <button
                type="button"
                className="report-submit-btn"
                disabled={submitting}
                onClick={handleSubmit}
              >
                {submitting ? "⏳ Передача в ситуаційну сітку..." : "📢 ПЕРЕДАТИ РАПОРТ ДО РАДАРУ"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
