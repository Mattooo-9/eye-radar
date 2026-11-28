import React, { useMemo, useState } from "react";
import type { TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { haversineMeters } from "../lib/geo";
import { findNearestLandmark } from "../lib/landmarks";
import { classifyClientDataCategory } from "../lib/targetSpecs";

interface LiveThreatDrawerProps {
  packets: TrackPacket[];
  location: TrustedLocation | null;
  selectedTargetId?: string | null;
  onSelectTarget: (packet: TrackPacket) => void;
  onFitAll: () => void;
  activeAlerts?: string[];
}

const TYPE_PRIORITY: Record<string, number> = {
  munition: 0,
  bomb: 1,
  uav: 2,
  fpv: 3,
  aircraft: 4,
  helicopter: 5,
  unknown: 6
};

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  munition: { label: "РАКЕТА", cls: "type-munition" },
  bomb: { label: "КАБ", cls: "type-bomb" },
  uav: { label: "БПЛА", cls: "type-uav" },
  fpv: { label: "FPV", cls: "type-fpv" },
  aircraft: { label: "ADS-B", cls: "type-aircraft" },
  helicopter: { label: "ГЕЛІК", cls: "type-helo" },
  unknown: { label: "ЦІЛЬ", cls: "type-unknown" }
};

function compassArrow(heading: number): string {
  const dirs = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  const idx = Math.round((((heading % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

function formatRadius(meters?: number): string {
  if (!meters || !Number.isFinite(meters)) return "";
  return meters >= 1000 ? `±${(meters / 1000).toFixed(0)} км` : `±${Math.round(meters)} м`;
}

export const LiveThreatDrawer: React.FC<LiveThreatDrawerProps> = ({
  packets,
  location,
  selectedTargetId,
  onSelectTarget,
  onFitAll,
  activeAlerts = []
}) => {
  const [expanded, setExpanded] = useState(false);

  const enriched = useMemo(() => {
    return packets
      .map((packet) => {
        const [id, type, lat, lon, heading, speed, , , uncertaintyRadius, , altitude, model, callsign] = packet;
        const dataCategory = classifyClientDataCategory(id, callsign);
        const isSensor = dataCategory === "sensor_observation";
        const speedKmh = speed > 0 ? Math.round(speed * 3.6) : null;
        const altM = typeof altitude === "number" && altitude > 0 ? Math.round(altitude) : null;
        const hasVector = speed > 0;
        const landmark = findNearestLandmark(lat, lon);
        const shortPlace = landmark.replace(/^~?\d+\s*км\s+[^\s]+\s+(від\s+)?/i, "").split("(")[0].trim();

        const distKm = location
          ? Math.round(haversineMeters({ lat, lon }, { lat: location.lat, lon: location.lon }) / 1000)
          : null;

        return {
          packet,
          id,
          type,
          dataCategory,
          isSensor,
          heading: Math.round(heading || 0),
          hasVector,
          speedKmh,
          altM,
          uncertaintyStr: formatRadius(uncertaintyRadius),
          model: model || (type === "uav" ? "БпЛА (тип не уточнено)" : "Повітряний об'єкт"),
          callsign: callsign || "",
          shortPlace: shortPlace || landmark,
          distKm
        };
      })
      .sort((a, b) => {
        const pa = TYPE_PRIORITY[a.type] ?? 9;
        const pb = TYPE_PRIORITY[b.type] ?? 9;
        if (pa !== pb) return pa - pb;
        if (a.distKm !== null && b.distKm !== null) return a.distKm - b.distKm;
        return a.model.localeCompare(b.model);
      });
  }, [packets, location]);

  const osintItems = useMemo(() => enriched.filter((e) => e.dataCategory === "osint_message"), [enriched]);
  const unverifiedItems = useMemo(() => enriched.filter((e) => e.dataCategory === "unverified_report"), [enriched]);
  const sensorItems = useMemo(() => enriched.filter((e) => e.dataCategory === "sensor_observation"), [enriched]);

  const countsText = useMemo(() => {
    const parts: string[] = [];
    if (osintItems.length > 0) parts.push(`${osintItems.length} ППО`);
    if (unverifiedItems.length > 0) parts.push(`${unverifiedItems.length} очев.`);
    if (sensorItems.length > 0) parts.push(`${sensorItems.length} ADS-B`);
    return parts.join(" · ");
  }, [osintItems.length, unverifiedItems.length, sensorItems.length]);

  const renderRow = (item: (typeof enriched)[number]) => {
    const badge = TYPE_BADGE[item.type] ?? TYPE_BADGE.unknown;
    const isSelected = selectedTargetId === item.id;
    return (
      <button
        key={item.id}
        type="button"
        className={`live-threat-row ${isSelected ? "selected" : ""} ${!item.isSensor ? "combat" : ""}`}
        onClick={() => {
          window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
          onSelectTarget(item.packet);
          setExpanded(false);
        }}
      >
        <div className="threat-row-top">
          <span className={`threat-type-pill ${badge.cls}`}>{badge.label}</span>
          <span className="threat-row-model">{item.model}</span>
          <span className="threat-row-speed">
            {item.speedKmh !== null
              ? `${compassArrow(item.heading)} ${item.speedKmh} км/год${item.altM ? ` · ${item.altM} м` : ""}`
              : item.hasVector
              ? `${compassArrow(item.heading)} ${item.heading}°`
              : item.uncertaintyStr || "Район"}
          </span>
        </div>
        <div className="threat-row-bottom">
          <span className="threat-row-place">📍 {item.shortPlace}</span>
          <span className="threat-row-meta">
            {item.distKm !== null ? <span>{item.distKm} км</span> : null}
            {item.callsign ? <span className="threat-src-tag">{item.callsign}</span> : null}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className={`live-threat-dock ${expanded ? "is-expanded" : ""}`}>
      {expanded && (
        <div className="live-threat-panel">
          <div className="live-threat-panel-header">
            <div className="live-threat-panel-title">
              <span className={`threat-pulse-dot ${osintItems.length > 0 ? "danger" : "calm"}`} />
              <strong>АКТИВНІ ЗАПИСИ ({enriched.length})</strong>
            </div>
            <div className="live-threat-panel-actions">
              {enriched.length > 0 && (
                <button
                  type="button"
                  className="threat-mini-btn"
                  onClick={() => {
                    onFitAll();
                    setExpanded(false);
                  }}
                >
                  Огляд
                </button>
              )}
              <button
                type="button"
                className="threat-mini-btn"
                onClick={() => setExpanded(false)}
                aria-label="Згорнути"
              >
                ✕
              </button>
            </div>
          </div>

          {enriched.length === 0 ? (
            <div className="live-threat-empty">
              Активних повідомлень ППО та військових бортів зараз немає. Система продовжує моніторинг у реальному часі.
            </div>
          ) : (
            <div className="live-threat-list">
              {osintItems.length > 0 && (
                <>
                  <div className="threat-group-label">Виявлені цілі ППО / Радар ({osintItems.length})</div>
                  {osintItems.map(renderRow)}
                </>
              )}
              {unverifiedItems.length > 0 && (
                <>
                  <div className="threat-group-label">Неперевірені повідомлення очевидців ({unverifiedItems.length})</div>
                  {unverifiedItems.map(renderRow)}
                </>
              )}
              {sensorItems.length > 0 && (
                <>
                  <div className="threat-group-label">Спостереження ADS-B ({sensorItems.length})</div>
                  {sensorItems.map(renderRow)}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className={`live-threat-pill ${osintItems.length > 0 || activeAlerts.length > 0 ? "has-combat" : "calm"}`}
        onClick={() => {
          window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
          setExpanded((prev) => !prev);
        }}
        title="Відкрити розділений список загроз, сповіщень ДСНС/ОВА та спостережень ADS-B"
      >
        <span className={`threat-pulse-dot ${osintItems.length > 0 || activeAlerts.length > 0 ? "danger" : "calm"}`} />
        <span className="live-threat-pill-main">
          {enriched.length > 0
            ? `ЦІЛІ: ${enriched.length}`
            : activeAlerts.length > 0
            ? `ТРИВОГА: ${activeAlerts.length} ОБЛ.`
            : "ТРИВОГ НЕМАЄ"}
        </span>
        {countsText && <span className="live-threat-pill-sub">{countsText}</span>}
        <span className="live-threat-pill-chevron">{expanded ? "▼" : "▲"}</span>
      </button>
    </div>
  );
};
