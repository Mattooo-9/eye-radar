import { useState } from "react";
import type { TrackPacket } from "../hooks/useWsRadar";
import { getLocationIntel } from "../lib/locationIntel";
import type { AlertFeedStatus } from "../types";

interface LocationCardProps {
  lat: number;
  lon: number;
  activeAlerts: string[];
  alertStatus?: AlertFeedStatus;
  alertsUpdatedAt?: number | null;
  packets: TrackPacket[];
  onClose: () => void;
  onCenterLocation: (lat: number, lon: number) => void;
}

export const LocationCard = ({
  lat,
  lon,
  activeAlerts,
  alertStatus = "fresh",
  alertsUpdatedAt = null,
  packets,
  onClose,
  onCenterLocation
}: LocationCardProps) => {
  const [copied, setCopied] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const intel = getLocationIntel(lat, lon, activeAlerts, packets, 65);
  const isAlertUnknown = alertStatus !== "fresh";
  const confirmedTimeStr = alertsUpdatedAt
    ? new Date(alertsUpdatedAt).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  const handleSubscribeBot = async () => {
    setSubscribing(true);
    try {
      const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
      const userId = tgUserId ? String(tgUserId) : localStorage.getItem("eye-radar-user-id");
      const res = await fetch("/api/alerts/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          lat,
          lon,
          cityName: intel.landmarkDesc || intel.regionName,
          radiusKm: 35
        })
      });
      if (res.ok) {
        setSubscribed(true);
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
      } else {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("error");
      }
    } catch {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("error");
    } finally {
      setSubscribing(false);
    }
  };

  const handleCopy = () => {
    const alertLabel = isAlertUnknown
      ? intel.hasActiveAlert
        ? `НЕ ОНОВЛЕНО (останнє: ТРИВОГА${confirmedTimeStr ? ` о ${confirmedTimeStr}` : ""})`
        : "СТАН НЕВІДОМИЙ (НЕ ВІДБІЙ)"
      : intel.hasActiveAlert
      ? "АКТИВНА"
      : "ВІДБІЙ";
    const text = `📍 ${intel.landmarkDesc} [${lat.toFixed(5)}°N, ${lon.toFixed(5)}°E] | Тривога: ${alertLabel} | Цілей у секторі: ${intel.nearbyThreats.length}`;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="location-card-overlay" onClick={onClose}>
      <div className="location-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="location-card-header">
          <div className="location-header-left">
            <div className="location-tag-row">
              <span className="location-region-badge">{intel.regionName}</span>
              <span
                className={`alert-status-pill ${
                  isAlertUnknown
                    ? "alert-pill-unknown"
                    : intel.hasActiveAlert
                    ? "alert-pill-active"
                    : "alert-pill-clear"
                }`}
              >
                {isAlertUnknown
                  ? intel.hasActiveAlert
                    ? "⚠ ОСТАННЄ: ТРИВОГА"
                    : "⚠ СТАН НЕВІДОМИЙ"
                  : intel.hasActiveAlert
                  ? "🚨 ТРИВОГА"
                  : "🟢 ВІДБІЙ"}
              </span>
            </div>
            <h3 className="location-name-title">{intel.landmarkDesc}</h3>
            <div className="location-coords-row">
              Координати: <span>{lat.toFixed(5)}°N, {lon.toFixed(5)}°E</span>
            </div>
          </div>
          <button className="location-close-btn" onClick={onClose} title="Закрити картку">
            ✕
          </button>
        </div>

        {/* Air Raid Alert Details Banner */}
        <div
          className={`location-alert-box ${
            isAlertUnknown
              ? "box-alert-unknown"
              : intel.hasActiveAlert
              ? "box-alert-danger"
              : "box-alert-safe"
          }`}
        >
          <div className="alert-box-icon">
            {isAlertUnknown ? "⚠️" : intel.hasActiveAlert ? "⚠️" : "🛡️"}
          </div>
          <div className="alert-box-content">
            <strong className="alert-box-title">
              {isAlertUnknown
                ? intel.hasActiveAlert
                  ? `Джерело тривог не оновлюється · останній стан: ТРИВОГА${confirmedTimeStr ? ` (${confirmedTimeStr})` : ""}`
                  : "Стан офіційної тривоги невідомий (це НЕ відбій)"
                : intel.hasActiveAlert
                ? `Повітряна тривога в секторі: ${intel.alertTypeDesc}`
                : "Повітряний простір: Відбій тривоги"}
            </strong>
            <p className="alert-box-advice">
              {isAlertUnknown
                ? "Втрата зв'язку з джерелом не означає відбій тривоги. Орієнтуйтесь на сирени та офіційні канали ДСНС / обласної ОВА."
                : intel.hasActiveAlert
                ? "Залишайтеся в укриттях! Не ігноруйте сигнали сирен. Дотримуйтесь правила двох стін."
                : `Офіційну тривогу у цьому районі не оголошено${confirmedTimeStr ? ` (підтверджено ${confirmedTimeStr})` : ""}.`}
            </p>
          </div>
        </div>

        {/* Airspace Threats in 65km Sector */}
        <div className="location-sector-threats">
          <div className="sector-threats-header">
            <span className="sector-title">
              Обстановка в небі (радіус 65 км)
            </span>
            <span
              className={`sector-count-badge ${
                intel.nearbyThreats.length > 0 ? "count-warning" : "count-clear"
              }`}
            >
              {intel.nearbyThreats.length > 0
                ? `${intel.nearbyThreats.length} ${
                    intel.nearbyThreats.length === 1 ? "ціль" : "цілі"
                  }`
                : "0 цілей"}
            </span>
          </div>

          {intel.closestThreat ? (
            <div className="closest-threat-card">
              <div className="threat-top-row">
                <span className="threat-model-name">
                  {intel.closestThreat.modelName}
                </span>
                {intel.closestThreat.altitudeM !== null && (
                  <span
                    className="threat-altitude-pill"
                    style={{
                      backgroundColor: `${intel.closestThreat.corridorBadgeColor}20`,
                      borderColor: intel.closestThreat.corridorBadgeColor,
                      color: intel.closestThreat.corridorBadgeColor
                    }}
                  >
                    {intel.closestThreat.flightLevel} ({intel.closestThreat.altitudeM} м)
                  </span>
                )}
              </div>

              <div className="threat-metrics-grid">
                <div className="threat-metric">
                  <span className="m-label">Дистанція</span>
                  <span className="m-val highlight">
                    ~{intel.closestThreat.distanceKm} км
                  </span>
                </div>

                <div className="threat-metric">
                  <span className="m-label">Швидкість</span>
                  <span className="m-val">
                    {intel.closestThreat.speedKmh !== null ? `${intel.closestThreat.speedKmh} км/год` : "Невідомо"}
                  </span>
                </div>

                <div className="threat-metric">
                  <span className="m-label">Курс</span>
                  <span className="m-val">
                    {intel.closestThreat.heading !== null ? `${intel.closestThreat.heading}°` : "Невідомо"}
                  </span>
                </div>

                <div className="threat-metric">
                  <span className="m-label">Підліт (ETA)</span>
                  <span
                    className={`m-val ${
                      intel.closestThreat.isApproaching ? "eta-danger" : ""
                    }`}
                  >
                    {intel.closestThreat.isApproaching
                      ? intel.closestThreat.etaMinutes !== null
                        ? `~${intel.closestThreat.etaMinutes} хв ${intel.closestThreat.etaSeconds} с`
                        : "Підлітає"
                      : "Курс повз"}
                  </span>
                </div>
              </div>

              {intel.nearbyThreats.length > 1 && (
                <div className="other-threats-summary">
                  Ще {intel.nearbyThreats.length - 1}{" "}
                  {intel.nearbyThreats.length - 1 === 1 ? "ціль" : "цілей"} у радіусі 65 км
                </div>
              )}
            </div>
          ) : (
            <div className="sector-clear-box">
              <span className="clear-icon">✅</span>
              <div className="clear-text">
                <strong>Сектор безпечний</strong>
                <span>У радіусі 65 км прямих повітряних загроз не виявлено.</span>
              </div>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="location-actions">
          <button
            type="button"
            className="loc-action-btn primary"
            onClick={() => onCenterLocation(lat, lon)}
          >
            Центрувати огляд
          </button>

          <button
            type="button"
            className={`loc-action-btn ${subscribed ? "subscribed" : "secondary"}`}
            onClick={handleSubscribeBot}
            disabled={subscribing}
            style={subscribed ? { backgroundColor: "#059669", borderColor: "#10b981", color: "#ffffff" } : {}}
          >
            {subscribed ? "Сповіщення в боті увімкнено!" : subscribing ? "Збереження..." : "Сповіщати про тривоги в боті"}
          </button>

          <button
            type="button"
            className="loc-action-btn secondary"
            onClick={handleCopy}
          >
            {copied ? "✅ Скопійовано!" : "📋 Скопіювати координати"}
          </button>
        </div>
      </div>
    </div>
  );
};
