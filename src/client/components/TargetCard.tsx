import type { TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { bearingDegrees, haversineMeters } from "../lib/geo";
import { findNearestLandmark } from "../lib/landmarks";

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
  const [id, type, lat, lon, heading, speed, timestamp, confidence, uncertaintyRadius, threatLevel, altitude] = packet;

  let distanceKm: number | null = null;
  let etaMinutes: number | null = null;

  if (location) {
    const distMeters = haversineMeters({ lat, lon }, { lat: location.lat, lon: location.lon });
    distanceKm = Math.round(distMeters / 1000);

    const bearingToUser = bearingDegrees({ lat, lon }, { lat: location.lat, lon: location.lon });
    const angleDiff = Math.min(Math.abs(heading - bearingToUser), 360 - Math.abs(heading - bearingToUser));

    if (angleDiff <= 50 && speed > 5) {
      const radialSpeed = speed * Math.cos((angleDiff * Math.PI) / 180);
      if (radialSpeed > 2) {
        etaMinutes = Math.round(distMeters / radialSpeed / 60);
      }
    }
  }

  const speedKmh = Math.round(speed * 3.6);
  const timeSecAgo = Math.round((Date.now() - timestamp) / 1000);
  const displayId = id.startsWith("adsb-") ? id.slice(5) : id;

  const getTypeTitle = (t: string) => {
    switch (t) {
      case "uav":
        return "БПЛА / Ударний дрон";
      case "munition":
        return "Крилата / Балістична ракета";
      case "aircraft":
        return id.startsWith("adsb-") ? `Борт ${displayId}` : "Авіація";
      case "helicopter":
        return "Гелікоптер";
      case "thermal":
        return "Теплова аномалія / спалах";
      default:
        return "Повітряна ціль";
    }
  };

  return (
    <div className="target-card-overlay" onClick={onClose}>
      <div className="target-card" onClick={(e) => e.stopPropagation()}>
        <div className="target-card-header">
          <div>
            <span className={`target-badge badge-${type}`}>{type.toUpperCase()}</span>
            <h3>{getTypeTitle(type)}</h3>
            <span className="target-id">{id}</span>
          </div>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="target-card-landmark">
          <span className="landmark-pin">📍</span>
          <span className="landmark-desc">{findNearestLandmark(lat, lon)}</span>
        </div>

        <div className="target-card-grid">
          <div className="metric">
            <span className="label">Швидкість</span>
            <span className="value">{speedKmh} км/год</span>
          </div>
          <div className="metric">
            <span className="label">Курс</span>
            <span className="value">{Math.round(heading)}°</span>
          </div>
          {altitude !== undefined && altitude !== null && (
            <div className="metric">
              <span className="label">Висота</span>
              <span className="value highlight">{Math.round(altitude)} м</span>
            </div>
          )}
          <div className="metric">
            <span className="label">Дистанція</span>
            <span className="value highlight">{distanceKm !== null ? `${distanceKm} км` : "—"}</span>
          </div>
          <div className="metric">
            <span className="label">Час підльоту (ETA)</span>
            <span className="value warning">{etaMinutes !== null ? `~${etaMinutes} хв` : "Курс повз"}</span>
          </div>
          <div className="metric">
            <span className="label">Довіра системи</span>
            <span className="value">{confidence ? `${Math.round(confidence * 100)}%` : "95%"}</span>
          </div>
          <div className="metric">
            <span className="label">Оновлено</span>
            <span className="value">{timeSecAgo} сек тому</span>
          </div>
        </div>

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
              🛰️ Зблизити (Zoom 19)
            </button>
          )}
        </div>

        {etaMinutes !== null && etaMinutes < 20 && (
          <div className="safety-alert">
            🚨 <strong>Увага!</strong> Ціль рухається у вашому напрямку. Перейдіть в безпечне місце або за правило двох стін.
          </div>
        )}
      </div>
    </div>
  );
};
