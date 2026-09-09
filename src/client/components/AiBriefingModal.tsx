import { useEffect, useState } from "react";

interface AiBriefingModalProps {
  isOpen: boolean;
  onClose: () => void;
  cityName?: string;
}

export const AiBriefingModal = ({ isOpen, onClose, cityName }: AiBriefingModalProps) => {
  const [loading, setLoading] = useState(false);
  const [briefing, setBriefing] = useState<string>("");

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    setLoading(true);

    const fetchBriefing = async () => {
      try {
        const query = cityName ? `?city=${encodeURIComponent(cityName)}` : "";
        const res = await fetch(`/api/briefing${query}`);
        if (!res.ok) throw new Error("Failed to load");
        const data = (await res.json()) as { briefing: string };
        if (mounted) {
          setBriefing(data.briefing);
        }
      } catch {
        if (mounted) {
          setBriefing("⚠️ Не вдалося отримати онлайн AI-зведення. Слідкуйте за картою та офіційними джерелами сповіщень.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void fetchBriefing();
    return () => {
      mounted = false;
    };
  }, [isOpen, cityName]);

  if (!isOpen) return null;

  return (
    <div className="briefing-overlay" onClick={onClose}>
      <div className="briefing-card" onClick={(e) => e.stopPropagation()}>
        <div className="briefing-header">
          <div className="briefing-title">
            <span className="briefing-icon">🤖</span>
            <span>ТАКТИЧНЕ AI-ЗВЕДЕННЯ</span>
          </div>
          <button className="briefing-close" onClick={onClose}>✕</button>
        </div>

        <div className="briefing-body">
          {loading ? (
            <div className="briefing-loading">
              <span className="radar-spinner"></span>
              <span>Штучний інтелект аналізує повітряну обстановку...</span>
            </div>
          ) : (
            <div className="briefing-text">
              {briefing.split("\n").map((line, idx) => (
                <p key={idx} className={line.startsWith("⚠️") || line.startsWith("🚨") ? "alert-line" : ""}>
                  {line.replace(/\*/g, "")}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="briefing-footer">
          <button className="briefing-action-btn" onClick={onClose}>
            ЗРОЗУМІЛО / НА КАРТУ
          </button>
        </div>
      </div>
    </div>
  );
};
