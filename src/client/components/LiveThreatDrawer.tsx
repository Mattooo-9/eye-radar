import React, { useMemo, useState } from "react";
import type { TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { bearingDegrees, haversineMeters } from "../lib/geo";
import { findNearestLandmark } from "../lib/landmarks";

interface LiveThreatDrawerProps {
  packets: TrackPacket[];
  location: TrustedLocation | null;
  selectedTargetId?: string | null;
  onSelectTarget: (packet: TrackPacket) => void;
  onFitAll: () => void;
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
  aircraft: { label: "АВІА", cls: "type-aircraft" },
  helicopter: { label: "ГЕЛІК", cls: "type-helo" },
  unknown: { label: "ЦІЛЬ", cls: "type-unknown" }
};

function compassArrow(heading: number): string {
  const dirs = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  const idx = Math.round((((heading % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

export const LiveThreatDrawer: React.FC<LiveThreatDrawerProps> = ({
  packets,
  location,
  selectedTargetId,
  onSelectTarget,
  onFitAll
}) => {
  const [expanded, setExpanded] = useState(false);

  const enriched = useMemo(() => {
    return packets
      .map((packet) => {
        const [id, type, lat, lon, heading, speed, , , , , , model, callsign] = packet;
        const speedKmh = Math.round((speed || 0) * 3.6);
        const landmark = findNearestLandmark(lat, lon);
        const shortPlace = landmark.replace(/^~?\d+\s*км\s+[^\s]+\s+(від\s+)?/i, "").split("(")[0].trim();

        let distKm: number | null = null;
        let etaMin: number | null = null;
        if (location) {
          const distM = haversineMeters({ lat, lon }, { lat: location.lat, lon: location.lon });
          distKm = Math.round(distM / 1000);
          const brg = bearingDegrees({ lat, lon }, { lat: location.lat, lon: location.lon });
          const diff = Math.min(Math.abs(heading - brg), 360 - Math.abs(heading - brg));
          if (diff <= 50 && speed > 5) {
            const radial = speed * Math.cos((diff * Math.PI) / 180);
            if (radial > 2) etaMin = Math.max(1, Math.round(distM / radial / 60));
          }
        }

        const isCombat = type === "uav" || type === "munition" || type === "bomb" || type === "fpv";
        return {
          packet,
          id,
          type,
          lat,
          lon,
          heading: Math.round(heading || 0),
          speedKmh,
          model: model || (type === "uav" ? "Ударний БпЛА" : type === "munition" ? "Ракета" : "Повітряна ціль"),
          callsign: callsign || "",
          shortPlace: shortPlace || landmark,
          distKm,
          etaMin,
          isCombat
        };
      })
      .sort((a, b) => {
        const pa = TYPE_PRIORITY[a.type] ?? 9;
        const pb = TYPE_PRIORITY[b.type] ?? 9;
        if (pa !== pb) return pa - pb;
        if (a.distKm !== null && b.distKm !== null) return a.distKm - b.distKm;
        return b.speedKmh - a.speedKmh;
      });
  }, [packets, location]);

  const combatCount = useMemo(() => enriched.filter((e) => e.isCombat).length, [enriched]);
  const countsText = useMemo(() => {
    const uav = enriched.filter((e) => e.type === "uav").length;
    const mun = enriched.filter((e) => e.type === "munition").length;
    const bomb = enriched.filter((e) => e.type === "bomb").length;
    const fpv = enriched.filter((e) => e.type === "fpv").length;
    const parts: string[] = [];
    if (mun > 0) parts.push(`${mun} рак`);
    if (bomb > 0) parts.push(`${bomb} КАБ`);
    if (uav > 0) parts.push(`${uav} БПЛА`);
    if (fpv > 0) parts.push(`${fpv} FPV`);
    return parts.join(" · ");
  }, [enriched]);

  return (
    <div className={`live-threat-dock ${expanded ? "is-expanded" : ""}`}>
      {expanded && (
        <div className="live-threat-panel">
          <div className="live-threat-panel-header">
            <div className="live-threat-panel-title">
              <span className={`threat-pulse-dot ${combatCount > 0 ? "danger" : "calm"}`} />
              <strong>АКТИВНІ ЦІЛІ ({enriched.length})</strong>
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
                  title="Показати всі цілі на карті"
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
              Активних військових цілей над Україною зараз не зафіксовано. 14 каналів ППО та ADS-B працюють у реальному часі.
            </div>
          ) : (
            <div className="live-threat-list">
              {enriched.map((item) => {
                const badge = TYPE_BADGE[item.type] ?? TYPE_BADGE.unknown;
                const isSelected = selectedTargetId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`live-threat-row ${isSelected ? "selected" : ""} ${item.isCombat ? "combat" : ""}`}
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
                        {compassArrow(item.heading)} {item.speedKmh} км/год
                      </span>
                    </div>
                    <div className="threat-row-bottom">
                      <span className="threat-row-place">📍 {item.shortPlace}</span>
                      <span className="threat-row-meta">
                        {item.etaMin !== null ? (
                          <strong className="threat-eta-hot">⏱ ~{item.etaMin} хв</strong>
                        ) : item.distKm !== null ? (
                          <span>{item.distKm} км</span>
                        ) : null}
                        {item.callsign ? <span className="threat-src-tag">{item.callsign}</span> : null}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className={`live-threat-pill ${combatCount > 0 ? "has-combat" : "calm"}`}
        onClick={() => {
          window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
          setExpanded((prev) => !prev);
        }}
        title="Відкрити список активних цілей у реальному часі"
      >
        <span className={`threat-pulse-dot ${combatCount > 0 ? "danger" : "calm"}`} />
        <span className="live-threat-pill-main">
          {enriched.length > 0 ? `ЦІЛІ: ${enriched.length}` : "НЕБО ЧИСТЕ"}
        </span>
        {countsText && <span className="live-threat-pill-sub">{countsText}</span>}
        <span className="live-threat-pill-chevron">{expanded ? "▼" : "▲"}</span>
      </button>
    </div>
  );
};
