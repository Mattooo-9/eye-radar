import { useEffect, useState } from "react";
import type { TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { bearingDegrees, haversineMeters } from "../lib/geo";
import { findNearestLandmark, predictDestinationLandmark } from "../lib/landmarks";
import {
  formatTruthfulCoords,
  getAltitudeAnalysis,
  getHeadingVectorDescription,
  getTargetDisplayMeta
} from "../lib/targetSpecs";
import { TrackInspectorModal } from "./TrackInspectorModal";

interface TargetCardProps {
  packet: TrackPacket;
  location: TrustedLocation | null;
  onClose: () => void;
  onFollowTarget?: (id: string) => void;
  onZoomTarget?: (lat: number, lon: number) => void;
}

interface LiveDiagnosticSnippet {
  provenanceStr?: string;
  source?: string;
  sourceFamily?: string;
  observedAt?: number;
  lifecycle?: string;
  measuredSpeed?: number;
  measuredAltitude?: number;
  measuredHeading?: number;
}

function formatUncertainty(meters?: number): string {
  if (!meters || !Number.isFinite(meters)) return "Невідомо";
  if (meters >= 1000) return `±${(meters / 1000).toFixed(1)} км`;
  return `±${Math.round(meters)} м`;
}

function formatAge(timestampMs: number): string {
  const sec = Math.max(0, Math.round((Date.now() - timestampMs) / 1000));
  if (sec < 60) return `${sec} сек тому`;
  const min = Math.floor(sec / 60);
  return `${min} хв тому`;
}

function formatLifecycleLabel(lifecycle?: string): string {
  switch (lifecycle) {
    case "CONFIRMED":
      return "ПІДТВЕРДЖЕНО";
    case "TENTATIVE":
      return "ПЕРЕВІРЯЄТЬСЯ";
    case "COASTING":
      return "УТРИМАННЯ";
    case "STALE":
      return "ЗАСТАРІЛО";
    default:
      return lifecycle || "";
  }
}

export const TargetCard = ({
  packet,
  location,
  onClose,
  onFollowTarget,
  onZoomTarget
}: TargetCardProps) => {
  const [showInspector, setShowInspector] = useState(false);
  const [copied, setCopied] = useState(false);
  const [liveDiag, setLiveDiag] = useState<LiveDiagnosticSnippet | null>(null);

  const [
    id,
    type,
    lat,
    lon,
    heading,
    speed,
    timestamp,
    confidence,
    uncertaintyRadius,
    ,
    altitude,
    packetModel,
    packetCallsign
  ] = packet;

  useEffect(() => {
    let cancelled = false;
    setLiveDiag(null);
    fetch(`/api/tracks/${encodeURIComponent(id)}/diagnostic`, { signal: AbortSignal.timeout(3500) })
      .then((r) => (r.ok ? r.json() : null))
      .then((diag) => {
        if (cancelled || !diag) return;
        const latest = Array.isArray(diag.provenanceChain) ? diag.provenanceChain[0] : null;
        setLiveDiag({
          provenanceStr: latest?.provenanceStr,
          source: latest?.source,
          sourceFamily: latest?.sourceFamily,
          observedAt: latest?.observedAt,
          lifecycle: diag.lifecycle,
          measuredSpeed: typeof diag.measuredSpeed === "number" ? diag.measuredSpeed : undefined,
          measuredAltitude: typeof diag.measuredAltitude === "number" ? diag.measuredAltitude : undefined,
          measuredHeading: typeof diag.measuredHeading === "number" ? diag.measuredHeading : undefined
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  const meta = getTargetDisplayMeta(type, id, packetModel, packetCallsign);
  const isSensor = meta.dataCategory === "sensor_observation";
  const isUnverified = meta.dataCategory === "unverified_report";

  // Display live speed and altitude (with clear provenance label: ADS-B sensor vs air-defense trajectory profile)
  const hasMeasuredSpeed = speed > 0 || liveDiag?.measuredSpeed !== undefined;
  const measuredSpeedKmh = hasMeasuredSpeed
    ? Math.round((liveDiag?.measuredSpeed ?? speed) * 3.6)
    : null;

  const actualAltM =
    liveDiag?.measuredAltitude ?? (altitude !== undefined && altitude !== null && altitude > 0 ? altitude : null);
  const altSummary = getAltitudeAnalysis(actualAltM);

  const hasKnownHeading =
    (Number.isFinite(heading) && speed > 0) || liveDiag?.measuredHeading !== undefined;
  const headingDesc = getHeadingVectorDescription(
    liveDiag?.measuredHeading ?? heading,
    hasKnownHeading
  );

  const nearestLandmark = findNearestLandmark(lat, lon);
  const destinationPrediction =
    hasMeasuredSpeed && hasKnownHeading && speed > 5
      ? predictDestinationLandmark(lat, lon, heading, speed)
      : null;

  let distanceKm: number | null = null;
  let etaMinutes: number | null = null;

  if (location) {
    const distMeters = haversineMeters({ lat, lon }, { lat: location.lat, lon: location.lon });
    distanceKm = Math.round(distMeters / 1000);

    if (hasMeasuredSpeed && hasKnownHeading && speed > 5) {
      const bearingToUser = bearingDegrees({ lat, lon }, { lat: location.lat, lon: location.lon });
      const angleDiff = Math.min(Math.abs(heading - bearingToUser), 360 - Math.abs(heading - bearingToUser));
      if (angleDiff <= 50) {
        const radialSpeed = speed * Math.cos((angleDiff * Math.PI) / 180);
        if (radialSpeed > 2) {
          etaMinutes = Math.max(1, Math.round(distMeters / radialSpeed / 60));
        }
      }
    }
  }

  const coordsText = formatTruthfulCoords(lat, lon, meta.dataCategory);

  const handleCopyCoords = () => {
    const spdPart = measuredSpeedKmh !== null ? `${measuredSpeedKmh} км/год` : "швидкість невідома";
    const altPart = altSummary ? `${altSummary.altitudeM} м` : "висота невідома";
    const text = `${meta.modelName} [${meta.dataCategoryBadge}]${packetCallsign ? ` (${packetCallsign})` : ""} | ${coordsText} (${formatUncertainty(uncertaintyRadius)}) | ${spdPart} | ${altPart} | ${nearestLandmark}`;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="target-card-overlay" onClick={onClose}>
      <div className="target-card target-card-minimal" onClick={(e) => e.stopPropagation()}>
        {/* Header: clear separation of data category + truthful model */}
        <div className="target-card-header">
          <div>
            <div className="target-badge-row">
              <span
                className={`target-category-pill ${
                  isSensor ? "cat-sensor" : isUnverified ? "cat-unverified" : "cat-osint"
                }`}
              >
                {meta.dataCategoryBadge}
              </span>
              {altSummary && (
                <span
                  className="altitude-pill"
                  style={{
                    backgroundColor: `${altSummary.badgeColor}20`,
                    borderColor: altSummary.badgeColor,
                    color: altSummary.badgeColor
                  }}
                >
                  {altSummary.flightLevel} ({altSummary.altitudeM} м)
                </span>
              )}
            </div>
            <h3 className="target-model-title">{meta.modelName}</h3>
            <span className="target-category-sub">{meta.categoryLabel}</span>
            <div className="target-id-chip">
              Джерело: {packetCallsign || liveDiag?.source || "Невідомо"} • Оновлено: {formatAge(liveDiag?.observedAt ?? timestamp)}
            </div>
          </div>
          <button type="button" className="close-btn" onClick={onClose} title="Закрити картку">
            ✕
          </button>
        </div>

        {/* Live Source Proof (100% empirical text quote or transponder metadata) */}
        <div className="target-live-provenance-box">
          <div className="live-prov-header">
            <span className="live-prov-dot" />
            <span className="live-prov-title">
              {isSensor ? "ФАКТИЧНЕ ДЖЕРЕЛО ТРАНСПОНДЕРА" : "РАДІОЛОКАЦІЙНИЙ КОНТРОЛЬ ППО"}
            </span>
            {liveDiag?.lifecycle && <span className="live-prov-status">{formatLifecycleLabel(liveDiag.lifecycle)}</span>}
          </div>
          <div className="live-prov-quote">
            {liveDiag?.provenanceStr ||
              (isSensor
                ? `Відкритий ADS-B/MLAT транспондер (${packetCallsign || id})`
                : `Радіолокаційне спостереження ППО · район: ${nearestLandmark}`)}
          </div>
        </div>

        {/* Location & Vector */}
        <div className="target-card-location-box">
          <div className="location-row">
            <div>
              <strong className="location-title">{nearestLandmark}</strong>
              <div className="location-coords">
                {isSensor ? "Координати" : "Орієнтовна зона"}: <span>{coordsText}</span> • Похибка:{" "}
                <span>{formatUncertainty(uncertaintyRadius)}</span>
              </div>
            </div>
          </div>

          <div className="vector-row">
            <div>
              <span className="vector-text">{headingDesc.forwardSummary}</span>
              {destinationPrediction && (
                <div className="destination-predicted">
                  Орієнтовний напрямок: <strong>{destinationPrediction.destinationName}</strong> (~{destinationPrediction.distanceKm} км)
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Strictly Factual Telemetry Grid (Unknown stays Unknown) */}
        <div className="target-card-grid">
          <div className="metric">
            <span className="label">Швидкість</span>
            <span className={`value ${measuredSpeedKmh !== null ? "highlight" : "unknown-val"}`}>
              {measuredSpeedKmh !== null ? `${measuredSpeedKmh} км/год` : "Невідомо"}
            </span>
            <span className="sub-value">
              {measuredSpeedKmh !== null
                ? isSensor
                  ? "Транспондер ADS-B"
                  : "Профіль цілі ППО"
                : "Дані відсутні"}
            </span>
          </div>

          <div className="metric">
            <span className="label">Висота польоту</span>
            <span className={`value ${altSummary ? "highlight" : "unknown-val"}`}>
              {altSummary ? `${altSummary.altitudeM} м` : "Невідомо"}
            </span>
            <span className="sub-value">
              {altSummary ? `${altSummary.flightLevel} • ${altSummary.bandLabel}` : "Дані відсутні"}
            </span>
          </div>

          <div className="metric">
            <span className="label">До вашої позиції</span>
            <span className="value">{distanceKm !== null ? `${distanceKm} км` : "Невідомо"}</span>
            <span className="sub-value">
              {location
                ? distanceKm !== null && distanceKm < 35
                  ? "У ближньому радіусі"
                  : "Поза ближнім радіусом"
                : "Локацію не задано"}
            </span>
          </div>

          <div className="metric">
            <span className="label">Точність позиції</span>
            <span className="value">{formatUncertainty(uncertaintyRadius)}</span>
            <span className="sub-value">
              {confidence ? `Довіра джерела: ${Math.round(confidence * 100)}%` : "Оцінка джерела"}
            </span>
          </div>
        </div>

        {/* Concise Civil Safety Guidance */}
        <div className="target-safety-note">
          <span>ℹ️ {meta.safetyNote}</span>
          {etaMinutes !== null && etaMinutes < 25 && (
            <strong className="safety-eta-warn">
              {" "}Орієнтовний підліт за вектором: ~{etaMinutes} хв — перейдіть в укриття.
            </strong>
          )}
        </div>

        {/* Progressive-Disclosure Action Controls */}
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
              Супроводжувати
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
              Наблизити
            </button>
          )}
          <button type="button" className="action-btn-copy" onClick={handleCopyCoords}>
            {copied ? "✓ Скопійовано" : "Копіювати"}
          </button>
          <button
            type="button"
            className="action-btn-zoom"
            style={{ borderColor: "#38bdf8", color: "#38bdf8", background: "rgba(2, 132, 199, 0.16)" }}
            onClick={() => setShowInspector(true)}
            title="Переглянути повну історію джерел та технічну діагностику"
          >
            Джерела та деталі
          </button>
        </div>
      </div>

      {showInspector && (
        <TrackInspectorModal targetId={id} onClose={() => setShowInspector(false)} />
      )}
    </div>
  );
};
