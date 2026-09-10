import { useEffect, useMemo, useState } from "react";
import type { Map } from "maplibre-gl";
import { AiBriefingModal } from "./components/AiBriefingModal";
import { CitizenReportModal } from "./components/CitizenReportModal";
import { LOCATIONS } from "./components/CitySelector";
import { MapView, type VisionMode } from "./components/MapView";
import { type FilterState } from "./components/StatusPanel";
import { TacticalParamsModal, type TacticalFilters } from "./components/TacticalParamsModal";
import { TacticalTopBar } from "./components/TacticalTopBar";
import { TacticalMenuModal } from "./components/TacticalMenuModal";
import { ImpactCard } from "./components/ImpactCard";
import { TargetCard } from "./components/TargetCard";
import { LocationCard } from "./components/LocationCard";
import { type ImpactEvent, type TrackPacket, useWsRadar } from "./hooks/useWsRadar";
import { haversineMeters } from "./lib/geo";
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
  const {
    location,
    isManual,
    trustScore,
    flags,
    needsManualConfirm,
    setManualLocation,
    resetToGps
  } = useTrustedLocation();
  const [isPickingLocation, setIsPickingLocation] = useState(false);
  const { packets, impacts, connectionState, mapStyleUrl } = useWsRadar(
    userId,
    location,
    trustScore,
    flags
  );

  const [mapInstance, setMapInstance] = useState<Map | null>(null);
  const [visionMode, setVisionMode] = useState<VisionMode>("satellite");
  const [selectedTarget, setSelectedTarget] = useState<TrackPacket | null>(null);
  const [inspectedTarget, setInspectedTarget] = useState<TrackPacket | null>(null);
  const [selectedImpact, setSelectedImpact] = useState<ImpactEvent | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [tacticalMenuOpen, setTacticalMenuOpen] = useState(false);
  const [threatOnly, setThreatOnly] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [selectedCityName, setSelectedCityName] = useState<string>("");
  const [activeAlerts, setActiveAlerts] = useState<string[]>([]);
  const [showWeather, setShowWeather] = useState(false);
  const [showSatellites, setShowSatellites] = useState(true);
  const [followedTargetId, setFollowedTargetId] = useState<string | null>(null);
  const [alertsModalOpen, setAlertsModalOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const handleSelectOblastFromAlert = (oblastName: string) => {
    const clean = oblastName.toLowerCase().replace("область", "").replace("обл.", "").trim();
    const match = LOCATIONS.find(
      (l) => l.name.toLowerCase().includes(clean) || l.region.toLowerCase().includes(clean)
    );
    if (match) {
      handleSelectCity(match.lat, match.lon, match.name, 8.5);
    }
  };

  const [tacticalFilters, setTacticalFilters] = useState<TacticalFilters>({
    autoTracking: true,
    minSpeedKmh: 0,
    maxSpeedKmh: 2500,
    threatOnly: false,
    dangerRadiusKm: 35,
    showWind: false
  });

  const [filters, setFilters] = useState<FilterState>({
    uav: true,
    munition: true,
    aircraft: true,
    helicopter: true,
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

  // Fetch real-time air raid alerts from alerts.in.ua
  useEffect(() => {
    let unmounted = false;
    const fetchAlerts = async () => {
      try {
        const res = await fetch("/api/alerts");
        if (res.ok) {
          const data = (await res.json()) as { alerts?: Array<{ active: boolean; name: string }> };
          if (Array.isArray(data.alerts)) {
            const active = data.alerts
              .filter((a) => a.active)
              .map((a) => a.name);
            if (!unmounted) {
              setActiveAlerts(active);
            }
          }
        }
      } catch {}
    };

    void fetchAlerts();
    const interval = setInterval(fetchAlerts, 15_000);
    return () => {
      unmounted = true;
      clearInterval(interval);
    };
  }, []);

  const handleCycleVision = () => {
    setVisionMode((prev) => {
      if (prev === "satellite") return "nvg";
      if (prev === "nvg") return "flir";
      if (prev === "flir") return "tactical";
      return "satellite";
    });
  };

  const filteredPackets = useMemo(() => {
    return packets.filter((p) => {
      const [, type, , , , speed] = p;
      const speedKmh = speed * 3.6;

      if (speedKmh < tacticalFilters.minSpeedKmh || speedKmh > tacticalFilters.maxSpeedKmh) {
        return false;
      }

      if ((tacticalFilters.threatOnly || threatOnly) && type !== "uav" && type !== "munition") {
        return false;
      }

      return true;
    });
  }, [packets, tacticalFilters, threatOnly]);

  // Auto-Sentinel: Locks tracking reticle onto closest threat WITHOUT opening popup modal
  useEffect(() => {
    if (!tacticalFilters.autoTracking || !location || filteredPackets.length === 0) {
      return;
    }

    let closest: TrackPacket | null = null;
    let minD = Infinity;

    for (const p of filteredPackets) {
      const [, type, lat, lon] = p;
      if (type === "uav" || type === "munition") {
        const d = haversineMeters({ lat, lon }, { lat: location.lat, lon: location.lon });
        if (d < minD) {
          minD = d;
          closest = p;
        }
      }
    }

    if (closest && minD <= tacticalFilters.dangerRadiusKm * 1000) {
      if (!selectedTarget || selectedTarget[0] !== closest[0]) {
        setSelectedTarget(closest);
      }
    }
  }, [filteredPackets, location, tacticalFilters, selectedTarget]);

  const targetCounts = useMemo(() => {
    let uav = 0;
    let munition = 0;
    let aircraft = 0;
    let helo = 0;
    for (const p of packets) {
      const type = p[1];
      if (type === "uav") uav++;
      else if (type === "munition") munition++;
      else if (type === "aircraft") aircraft++;
      else if (type === "helicopter") helo++;
    }
    return { uav, munition, aircraft, helo };
  }, [packets]);

  const handleFitAllTargets = () => {
    if (!mapInstance) return;
    if (filteredPackets.length > 0) {
      let minLon = Infinity;
      let minLat = Infinity;
      let maxLon = -Infinity;
      let maxLat = -Infinity;
      for (const [, , lat, lon] of filteredPackets) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
      mapInstance.fitBounds(
        [
          [Math.max(22.0, minLon - 0.5), Math.max(44.0, minLat - 0.4)],
          [Math.min(40.5, maxLon + 0.5), Math.min(52.5, maxLat + 0.4)]
        ],
        { padding: 70, maxZoom: 8.5, duration: 1200 }
      );
    } else {
      mapInstance.flyTo({
        center: [31.5, 49.0],
        zoom: 6.0,
        pitch: 0,
        bearing: 0,
        duration: 1200
      });
    }
  };

  const handleSelectCity = (lat: number, lon: number, cityName: string, zoomLevel?: number) => {
    setSelectedCityName(cityName);
    if (cityName.includes("Вся Україна") || (lat === 49.0 && lon === 31.5 && (!zoomLevel || zoomLevel <= 6.5))) {
      handleFitAllTargets();
      return;
    }
    setManualLocation({ lat, lon });
    if (mapInstance) {
      mapInstance.flyTo({
        center: [lon, lat],
        zoom: zoomLevel ?? 8.5,
        pitch: 0,
        bearing: 0,
        duration: 1200
      });
    }
  };

  const handlePickLocation = (lat: number, lon: number) => {
    setManualLocation({ lat, lon });
    setIsPickingLocation(false);
    if (mapInstance) {
      mapInstance.flyTo({
        center: [lon, lat],
        zoom: 9.0,
        pitch: 0,
        bearing: 0,
        duration: 1200
      });
    }
  };

  const handleFlyToUser = () => {
    if (!mapInstance || !location) return;
    mapInstance.flyTo({
      center: [location.lon, location.lat],
      zoom: 9.0,
      pitch: 0,
      bearing: 0,
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
      {/* 1. Sleek, ultra-compact tactical top bar (44px height) */}
      <TacticalTopBar
        threatCount={filteredPackets.length}
        activeAlertsCount={activeAlerts.length}
        onOpenMenu={() => setTacticalMenuOpen(true)}
        onOpenReport={() => setReportOpen(true)}
        onOpenAlerts={() => setAlertsModalOpen(true)}
      />

      {/* 2. Full-screen map (edge to edge, clean, zero watermarks) */}
      <MapView
        packets={filteredPackets}
        impacts={impacts}
        mapStyleUrl={mapStyleUrl}
        location={location}
        filters={filters}
        visionMode={visionMode}
        selectedTarget={selectedTarget}
        selectedImpact={selectedImpact}
        selectedLocation={selectedLocation}
        isPickingLocation={isPickingLocation}
        showDayNight={true}
        showWeather={showWeather}
        showSatellites={showSatellites}
        followingTargetId={followedTargetId}
        onStopFollow={() => setFollowedTargetId(null)}
        onMapReady={(m) => setMapInstance(m)}
        onPickLocation={handlePickLocation}
        onSelectTarget={(target) => {
          setSelectedTarget(target);
          setInspectedTarget(target);
          setSelectedImpact(null);
          setSelectedLocation(null);
        }}
        onSelectImpact={(event) => {
          setSelectedImpact(event);
          setInspectedTarget(null);
          setSelectedLocation(null);
        }}
        onSelectLocation={(lat, lon) => {
          setSelectedLocation({ lat, lon });
          setInspectedTarget(null);
          setSelectedImpact(null);
        }}
      />

      {/* 3. The Unified Tactical Options Drawer / Dropdown */}
      <TacticalMenuModal
        isOpen={tacticalMenuOpen}
        onClose={() => setTacticalMenuOpen(false)}
        map={mapInstance}
        visionMode={visionMode}
        onSelectVision={(mode) => setVisionMode(mode)}
        showWeather={showWeather}
        onToggleWeather={() => setShowWeather((prev) => !prev)}
        showSatellites={showSatellites}
        onToggleSatellites={() => setShowSatellites((prev) => !prev)}
        soundEnabled={filters.sound !== false}
        onToggleSound={() => handleToggleFilter("sound")}
        filters={filters}
        onToggleFilter={handleToggleFilter}
        threatOnly={threatOnly}
        onToggleThreatOnly={() => setThreatOnly((prev) => !prev)}
        uavCount={targetCounts.uav}
        munitionCount={targetCounts.munition}
        aircraftCount={targetCounts.aircraft}
        heloCount={targetCounts.helo}
        totalTrackCount={filteredPackets.length}
        onFitAllTargets={handleFitAllTargets}
        location={location}
        isManual={isManual}
        isPickingLocation={isPickingLocation}
        onTogglePickLocation={() => setIsPickingLocation((prev) => !prev)}
        onResetGps={resetToGps}
        onSelectCity={handleSelectCity}
        impacts={impacts}
        onFlyToCoord={(lat, lon) => {
          mapInstance?.flyTo({ center: [lon, lat], zoom: 12.5, duration: 1200 });
        }}
        onOpenBriefing={() => setBriefingOpen(true)}
        onOpenReport={() => setReportOpen(true)}
        activeAlerts={activeAlerts}
      />

      {/* 4. Active Target Flyout Card */}
      {inspectedTarget && (
        <TargetCard
          packet={inspectedTarget}
          location={location}
          onClose={() => setInspectedTarget(null)}
          onFollowTarget={(id) => setFollowedTargetId(id)}
          onZoomTarget={(lat, lon) => {
            setFollowedTargetId(null);
            mapInstance?.flyTo({
              center: [lon, lat],
              zoom: 17.5,
              pitch: 0,
              bearing: 0,
              duration: 1200
            });
          }}
        />
      )}

      {/* 5. Active Impact / Detonation Flyout Card */}
      {selectedImpact && (
        <ImpactCard
          event={selectedImpact}
          onClose={() => setSelectedImpact(null)}
          onCenter={(lat, lon) => {
            mapInstance?.flyTo({
              center: [lon, lat],
              zoom: 14.0,
              duration: 1200
            });
          }}
        />
      )}

      {/* 6. Selected Custom Location Card */}
      {selectedLocation && !inspectedTarget && !selectedImpact && (
        <LocationCard
          lat={selectedLocation.lat}
          lon={selectedLocation.lon}
          activeAlerts={activeAlerts}
          packets={filteredPackets}
          onClose={() => setSelectedLocation(null)}
          onCenterLocation={(lat, lon) => {
            mapInstance?.flyTo({
              center: [lon, lat],
              zoom: 11.0,
              pitch: 0,
              bearing: 0,
              duration: 1200
            });
          }}
        />
      )}

      {/* 7. Active Alerts Modal (when clicking alarm pill) */}
      {alertsModalOpen && (
        <div className="alerts-modal-overlay" onClick={() => setAlertsModalOpen(false)}>
          <div className="alerts-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="alerts-modal-header">
              <div className="alerts-modal-title">
                <span className="ticker-icon">🚨</span>
                <strong>ПОВІТРЯНІ ТРИВОГИ В УКРАЇНІ ({activeAlerts.length})</strong>
              </div>
              <button
                type="button"
                className="alerts-modal-close"
                onClick={() => setAlertsModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="alerts-modal-sub">
              Натисніть на область для миттєвого переходу камери:
            </div>
            <div className="alerts-regions-grid">
              {activeAlerts.map((regionName) => (
                <button
                  key={regionName}
                  type="button"
                  className="alert-region-chip"
                  onClick={() => {
                    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
                    handleSelectOblastFromAlert(regionName);
                    setAlertsModalOpen(false);
                  }}
                >
                  <span className="alert-beacon-dot" />
                  <span className="alert-region-text">{regionName}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <AiBriefingModal
        isOpen={briefingOpen}
        cityName={selectedCityName}
        onClose={() => setBriefingOpen(false)}
      />

      <CitizenReportModal
        isOpen={reportOpen}
        location={location}
        trustScore={trustScore}
        onClose={() => setReportOpen(false)}
      />
    </main>
  );
};

export default App;
