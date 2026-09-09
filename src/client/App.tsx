import { useEffect, useMemo, useState } from "react";
import type { Map } from "maplibre-gl";
import { AiBriefingModal } from "./components/AiBriefingModal";
import { CitySelector } from "./components/CitySelector";
import { ManualLocationPrompt } from "./components/ManualLocationPrompt";
import { MapView, type VisionMode } from "./components/MapView";
import { OrbitalControls } from "./components/OrbitalControls";
import { OrbitalHud } from "./components/OrbitalHud";
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

  const [mapInstance, setMapInstance] = useState<Map | null>(null);
  const [visionMode, setVisionMode] = useState<VisionMode>("satellite");
  const [selectedTarget, setSelectedTarget] = useState<TrackPacket | null>(null);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [selectedCityName, setSelectedCityName] = useState<string>("");
  const [filters, setFilters] = useState<FilterState>({
    uav: true,
    munition: true,
    aircraft: true,
    sound: soundEngine.isSoundEnabled()
  });

  useEffect(() => {
    try {
      window.Telegram?.WebApp?.ready();
      window.Telegram?.WebApp?.expand();
      window.Telegram?.WebApp?.setHeaderColor?.("#0b1220");
      window.Telegram?.WebApp?.setBackgroundColor?.("#070b14");
    } catch {}
  }, []);

  const handleCycleVision = () => {
    setVisionMode((prev) => {
      if (prev === "satellite") return "nvg";
      if (prev === "nvg") return "flir";
      if (prev === "flir") return "tactical";
      return "satellite";
    });
  };

  const handleSelectCity = (lat: number, lon: number, cityName: string) => {
    setSelectedCityName(cityName);
    setManualLocation({ lat, lon });
    if (mapInstance) {
      mapInstance.flyTo({
        center: [lon, lat],
        zoom: 8.5,
        pitch: 54,
        duration: 1200
      });
    }
  };

  const handleFlyToUser = () => {
    if (!mapInstance || !location) return;
    mapInstance.flyTo({
      center: [location.lon, location.lat],
      zoom: 9.0,
      pitch: 58,
      duration: 1400
    });
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
      <OrbitalHud
        map={mapInstance}
        trackCount={packets.length}
        onOpenBriefing={() => setBriefingOpen(true)}
      />

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
        visionMode={visionMode}
        selectedTarget={selectedTarget}
        onMapReady={(m) => setMapInstance(m)}
        onSelectTarget={(target) => setSelectedTarget(target)}
      />

      <div className="top-controls">
        <CitySelector onSelectCity={handleSelectCity} />
      </div>

      <OrbitalControls
        map={mapInstance}
        visionMode={visionMode}
        onCycleVision={handleCycleVision}
        onFlyToUser={handleFlyToUser}
      />

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

      <AiBriefingModal
        isOpen={briefingOpen}
        cityName={selectedCityName}
        onClose={() => setBriefingOpen(false)}
      />
    </main>
  );
};

export default App;
