import { useMemo, useState } from "react";
import type { TrackPacket } from "../hooks/useWsRadar";
import type { TrustedLocation } from "../location/useTrustedLocation";
import { bearingDegrees, haversineMeters } from "../lib/geo";

interface ThreatBannerProps {
  packets: TrackPacket[];
  location: TrustedLocation | null;
  onSelectTarget: (packet: TrackPacket) => void;
}

export const ThreatBanner = ({ packets, location, onSelectTarget }: ThreatBannerProps) => {
  const [showShelterGuide, setShowShelterGuide] = useState(false);

  const closestThreat = useMemo(() => {
    if (!location || packets.length === 0) {
      return null;
    }

    let minEta = Infinity;
    let mostUrgent: { packet: TrackPacket; distanceKm: number; etaMin: number } | null = null;

    for (const packet of packets) {
      const [_id, _type, lat, lon, heading, speed] = packet;
      const distM = haversineMeters({ lat, lon }, { lat: location.lat, lon: location.lon });
      const distKm = Math.round(distM / 1000);

      // Only evaluate if within 70 km
      if (distKm <= 70) {
        const bearingToUser = bearingDegrees({ lat, lon }, { lat: location.lat, lon: location.lon });
        const angleDiff = Math.min(Math.abs(heading - bearingToUser), 360 - Math.abs(heading - bearingToUser));

        if (angleDiff <= 45 && speed > 5) {
          const radialSpeed = speed * Math.cos((angleDiff * Math.PI) / 180);
          const etaMin = Math.round(distM / radialSpeed / 60);

          if (etaMin < minEta) {
            minEta = etaMin;
            mostUrgent = { packet, distanceKm: distKm, etaMin };
          }
        }
      }
    }

    return mostUrgent;
  }, [location, packets]);

  if (!closestThreat) {
    return null;
  }

  const { packet, distanceKm, etaMin } = closestThreat;
  const targetType = packet[1] === "munition" ? "Ракета" : "БПЛА";

  return (
    <>
      <div className={`threat-banner ${etaMin <= 10 ? "critical" : "warning"}`}>
        <div className="threat-info" onClick={() => onSelectTarget(packet)}>
          <span className="threat-icon">!</span>
          <div className="threat-text">
            <strong>{targetType} курсом на ваш сектор!</strong>
            <span>Дистанція: <b>{distanceKm} км</b> • ETA: <b>~{etaMin} хв</b></span>
          </div>
        </div>
        <button className="shelter-btn" onClick={() => setShowShelterGuide(true)}>
          В укриття
        </button>
      </div>

      {showShelterGuide && (
        <div className="modal-overlay" onClick={() => setShowShelterGuide(false)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <h3>Правила безпеки при повітряній загрозі</h3>
            <ul>
              <li><strong>Правило двох стін:</strong> Перейдіть у коридор, ванну або тамбур подалі від вікон.</li>
              <li><strong>Укриття:</strong> Якщо поруч є метро або облаштоване бомбосховище — негайно прямуйте туди.</li>
              <li><strong>Вікна:</strong> Не підходьте до вікон, не знімайте роботу ППО.</li>
              <li><strong>Звук мопеда (Shahed):</strong> Падайте на землю в заглиблення та закривайте голову руками.</li>
            </ul>
            <button className="submit-btn" onClick={() => setShowShelterGuide(false)}>Зрозуміло</button>
          </div>
        </div>
      )}
    </>
  );
};
