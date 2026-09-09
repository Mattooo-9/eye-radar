import { useEffect, useMemo, useState } from "react";
import { CitySelector } from "./components/CitySelector";
import { ManualLocationPrompt } from "./components/ManualLocationPrompt";
import { MapView } from "./components/MapView";
import { StatusPanel } from "./components/StatusPanel";
import { TargetCard } from "./components/TargetCard";
import { ThreatBanner } from "./components/ThreatBanner";
import { type TrackPacket, useWsRadar } from "./hooks/useWsRadar";
import { useTrustedLocation } from "./location/useTrustedLocation";

const getUserId = (): string => {
  const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (tgUserId) {
    return String(tgUserId);
  }

  const stored = localStorage.getItem("eye-radar-user-id");
  if (stored) {
    return stored;
  }

  const generated = crypto.randomUUID();
  localStorage.setItem("eye-radar-user-id", generated);
  return generated;
};

export const App = () => {
  const userId = useMemo(getUserId, []);
  const { location, trustScore, flags, needsManualConfirm, setManualLocation } =
    useTrustedLocation();
  const { packets, connectionState, mapStyleUrl } = useWsRadar(
    userId,
    location,
    trustScore,
    flags
  );

  const [selectedTarget, setSelectedTarget] = useState<TrackPacket | null>(null);

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
  }, []);

  const handleSelectCity = (lat: number, lon: number, cityName: string) => {
    setManualLocation({ lat, lon });
  };

  return (
    <main className="app-shell">
      <ThreatBanner
        packets={packets}
        location={location}
        onSelectTarget={(target) => setSelectedTarget(target)}
      />

      <MapView
        packets={packets}
        mapStyleUrl={mapStyleUrl}
        location={location}
        onSelectTarget={(target) => setSelectedTarget(target)}
      />

      <div className="top-controls">
        <CitySelector onSelectCity={handleSelectCity} />
      </div>

      <StatusPanel
        trackCount={packets.length}
        connectionState={connectionState}
        trustScore={trustScore}
        flags={flags}
      />

      {selectedTarget && (
        <TargetCard
          packet={selectedTarget}
          location={location}
          onClose={() => setSelectedTarget(null)}
        />
      )}

      {needsManualConfirm && (
        <ManualLocationPrompt onSubmit={setManualLocation} />
      )}
    </main>
  );
};

export default App;
