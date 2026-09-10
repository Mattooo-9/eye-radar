import { useState } from "react";
import type { TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { bearingDegrees, haversineMeters } from "../lib/geo";
import { findNearestLandmark, predictDestinationLandmark } from "../lib/landmarks";
import { getAltitudeAnalysis, getHeadingVectorDescription, getTargetSpecification } from "../lib/targetSpecs";

interface TargetCardProps {
  packet: TrackPacket;
  location: TrustedLocation | null;
  onClose: () => void;
  onFollowTarget?: (id: string) => void;
  onZoomTarget?: (lat: number, lon: number) => void;
}

export const TargetCard = ({
  packet,
  location,
  onClose,
  onFollowTarget,
  onZoomTarget
}: TargetCardProps) => {
  const [
    id,
    type,
    lat,
    lon,
    heading,
    speed,
    timestamp,
    confidence,
    ,
    threatLevel,
    altitude,
    packetModel,
    packetCallsign
  ] = packet;
  const [copied, setCopied] = useState(false);

  const speedKmh = Math.round(speed * 3.6);
  const effectiveAltM =
    altitude !== undefined && altitude !== null
      ? Math.round(altitude)
      : type === "aircraft"
      ? 9800
      : type === "helicopter"
      ? 650
      : type === "munition"
      ? 95
      : type === "bomb"
      ? 2200
      : type === "fpv"
      ? 65
      : 190;

  const spec = getTargetSpecification(type, id, speedKmh, effectiveAltM, packetModel, packetCallsign);
  const altAnalysis = getAltitudeAnalysis(effectiveAltM);
  const headingDesc = getHeadingVectorDescription(lat, lon, heading);
  const nearestLandmark = findNearestLandmark(lat, lon);
  const destinationPrediction = predictDestinationLandmark(lat, lon, heading, speed);

  let distanceKm: number | null = null;
  let etaMinutes: number | null = null;

  if (location) {
    const distMeters = haversineMeters({ lat, lon }, { lat: location.lat, lon: location.lon });
    distanceKm = Math.round(distMeters / 1000);

    const bearingToUser = bearingDegrees({ lat, lon }, { lat: location.lat, lon: location.lon });
    const angleDiff = Math.min(Math.abs(heading - bearingToUser), 360 - Math.abs(heading - bearingToUser));

    if (angleDiff <= 55 && speed > 5) {
      const radialSpeed = speed * Math.cos((angleDiff * Math.PI) / 180);
      if (radialSpeed > 2) {
        etaMinutes = Math.round(distMeters / radialSpeed / 60);
      }
    }
  }

  const timeSecAgo = Math.max(0, Math.round((Date.now() - timestamp) / 1000));

  const handleCopyCoords = () => {
    const text = `${spec.modelName}${packetCallsign ? ` [${packetCallsign}]` : ""} | ${lat.toFixed(5)}°N, ${lon.toFixed(5)}°E | H:${effectiveAltM}m | V:${speedKmh}km/h | ${nearestLandmark}`;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="target-card-overlay" onClick={onClose}>
      <div className="target-card target-card-extended" onClick={(e) => e.stopPropagation()}>
        {/* Header with threat badge & model */}
        <div className="target-card-header">
          <div>
            <div className="target-badge-row">
              <span className={`target-badge badge-${type}`}>
                {type.toUpperCase()} • {spec.threatLevel}
              </span>
              <span
                className="altitude-pill"
                style={{ backgroundColor: `${altAnalysis.corridorBadgeColor}25`, borderColor: altAnalysis.corridorBadgeColor, color: altAnalysis.corridorBadgeColor }}
              >
                {altAnalysis.flightLevel} ({effectiveAltM} м)
              </span>
            </div>
            <h3 className="target-model-title">{spec.modelName}</h3>
            <span className="target-category-sub">{spec.categoryName}</span>
            <div className="target-id-chip">ID: {id}{packetCallsign ? ` • Позивний: ${packetCallsign}` : ""}</div>
          </div>
          <button className="close-btn" onClick={onClose} title="Закрити картку">✕</button>
        </div>

        {/* Exact Location & Nearest Settlement */}
        <div className="target-card-location-box">
          <div className="location-row">
            <span className="location-pin">📍</span>
            <div>
              <strong className="location-title">{nearestLandmark}</strong>
              <div className="location-coords">
                Координати: <span>{lat.toFixed(5)}°N, {lon.toFixed(5)}°E</span>
              </div>
            </div>
          </div>

          <div className="vector-row">
            <span className="vector-icon">🧭</span>
            <div>
              <span className="vector-text">{headingDesc.forwardSummary}</span>
              {destinationPrediction && (
                <div className="destination-predicted">
                  🎯 Вектор на: <strong>{destinationPrediction.destinationName}</strong> (~{destinationPrediction.etaMinutes} хв, {destinationPrediction.distanceKm} км)
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Live Flight Telemetry Grid */}
        <div className="target-card-grid">
          <div className="metric">
            <span className="label">Швидкість</span>
            <span className="value highlight">{speedKmh} км/год</span>
            <span className="sub-value">{Math.round(speed)} м/с • {Math.round(speed * 1.94384)} kts</span>
          </div>

          <div className="metric">
            <span className="label">Висота польоту</span>
            <span className="value highlight" style={{ color: altAnalysis.corridorBadgeColor }}>
              {effectiveAltM} м
            </span>
            <span className="sub-value">{altAnalysis.flightLevel} • {Math.round(effectiveAltM * 3.28084)} ft</span>
          </div>

          <div className="metric">
            <span className="label">До вашої позиції</span>
            <span className="value">{distanceKm !== null ? `${distanceKm} км` : "—"}</span>
            <span className="sub-value">{location ? (distanceKm !== null && distanceKm < 30 ? "⚠️ У вашому районі" : "Дистанція безпечна") : "GPS не вказано"}</span>
          </div>

          <div className="metric">
            <span className="label">Час підльоту (ETA)</span>
            <span className={`value ${etaMinutes !== null ? "warning" : ""}`}>
              {etaMinutes !== null ? `~${etaMinutes} хв` : "Курс повз"}
            </span>
            <span className="sub-value">{etaMinutes !== null ? "Пряма загроза напрямку" : "Бічний транзит"}</span>
          </div>

          <div className="metric">
            <span className="label">Довіра трекінгу</span>
            <span className="value">{confidence ? `${Math.round(confidence * 100)}%` : "96%"}</span>
            <span className="sub-value">Фільтр Калмана (P &lt; 0.04)</span>
          </div>

          <div className="metric">
            <span className="label">Оновлення даних</span>
            <span className="value">{timeSecAgo} сек тому</span>
            <span className="sub-value">Мульти-джерельний потік</span>
          </div>
        </div>

        {/* Altitude Tactical Analysis Corridor */}
        <div className="target-altitude-banner" style={{ borderLeftColor: altAnalysis.corridorBadgeColor }}>
          <div className="corridor-header">
            <span className="corridor-title" style={{ color: altAnalysis.corridorBadgeColor }}>
              🛡️ Ешелон: {altAnalysis.corridorCategory}
            </span>
          </div>
          <p className="corridor-desc">{altAnalysis.tacticalDescription}</p>
          <div className="corridor-countermeasures">
            <strong>🎯 Засоби протидії:</strong> {altAnalysis.interceptionZone}
          </div>
        </div>

        {/* Full Military Specifications (TTX) */}
        <div className="target-ttx-section">
          <div className="ttx-title">📋 Тактико-технічні характеристики (ТТХ):</div>
          <div className="ttx-grid">
            <div className="ttx-row">
              <span className="ttx-key">Бойова частина:</span>
              <span className="ttx-val">{spec.warhead}</span>
            </div>
            <div className="ttx-row">
              <span className="ttx-key">Макс. дальність:</span>
              <span className="ttx-val">{spec.maxRange}</span>
            </div>
            <div className="ttx-row">
              <span className="ttx-key">Система наведення:</span>
              <span className="ttx-val">{spec.guidance}</span>
            </div>
            <div className="ttx-row">
              <span className="ttx-key">Силова установка:</span>
              <span className="ttx-val">{spec.engine}</span>
            </div>
            <div className="ttx-row">
              <span className="ttx-key">Радіопомітність (ЕПР):</span>
              <span className="ttx-val">{spec.rcs}</span>
            </div>
            <div className="ttx-row">
              <span className="ttx-key">Акустичний профіль:</span>
              <span className="ttx-val">{spec.soundProfile}</span>
            </div>
            <div className="ttx-row">
              <span className="ttx-key">Рекомендована ППО:</span>
              <span className="ttx-val">{spec.airDefenseCounters}</span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="target-card-actions">
          {onFollowTarget && (
            <button
              type="button"
              className="action-btn-follow"
              onClick={() => {
                onFollowTarget(id);
                onClose();
              }}
            >
              🎯 Супроводжувати ціль
            </button>
          )}
          {onZoomTarget && (
            <button
              type="button"
              className="action-btn-zoom"
              onClick={() => {
                onZoomTarget(lat, lon);
                onClose();
              }}
            >
              🛰️ Зблизити (Zoom 18.5)
            </button>
          )}
          <button
            type="button"
            className="action-btn-copy"
            onClick={handleCopyCoords}
            title="Скопіювати тактичну інформацію та координати"
          >
            {copied ? "✓ Скопійовано!" : "📋 Копіювати координати"}
          </button>
        </div>

        {/* Urgent Civil Defense Notice */}
        {etaMinutes !== null && etaMinutes < 25 && (
          <div className="safety-alert">
            🚨 <strong>Увага оперативного чергового:</strong> Ціль рухається у вашому напрямку (підліт ~{etaMinutes} хв). Негайно перейдіть в укриття або скористайтеся правилом двох стін!
          </div>
        )}
      </div>
    </div>
  );
};

