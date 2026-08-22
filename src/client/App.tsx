import { useEffect, useMemo } from "react";
import { ManualLocationPrompt } from "./components/ManualLocationPrompt";
import { MapView } from "./components/MapView";
import { StatusPanel } from "./components/StatusPanel";
import { useWsRadar } from "./hooks/useWsRadar";
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

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
  }, []);

  return (
    <main className="app-shell">
      <MapView packets={packets} mapStyleUrl={mapStyleUrl} location={location} />
      <StatusPanel
        trackCount={packets.length}
        connectionState={connectionState}
        trustScore={trustScore}
        flags={flags}
      />
      {needsManualConfirm ? <ManualLocationPrompt onSubmit={setManualLocation} /> : null}
    </main>
  );
};

export default App;
