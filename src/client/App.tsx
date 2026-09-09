import { useEffect, useMemo, useState } from "react";
import { CitySelector } from "./components/CitySelector";
import { ManualLocationPrompt } from "./components/ManualLocationPrompt";
import { MapView } from "./components/MapView";
import { type FilterState, StatusPanel } from "./components/StatusPanel";
import { TargetCard } from "./components/TargetCard";
import { ThreatBanner } from "./components/ThreatBanner";
import { type TrackPacket, useWsRadar } from "./hooks/useWsRadar";
import { soundEngine } from "./lib/sound";
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
  const [filters, setFilters] = useState<FilterState>({
    uav: true,
    munition: true,
    aircraft: true,
    sound: soundEngine.isSoundEnabled()
  });

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
  }, []);

  const handleSelectCity = (lat: number, lon: number, cityName: string) => {
    setManualLocation({ lat, lon });
  };

  const handleToggleFilter = (key: keyof FilterState) => {
    if (key === "sound") {
      const next = soundEngine.toggleSound();
      setFilters((prev) => ({ ...prev, sound: next }));
    } else {
      setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
    }
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
        filters={filters}
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
        filters={filters}
        onToggleFilter={handleToggleFilter}
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
