import React, { useEffect, useMemo, useState } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import type { Map } from "maplibre-gl";
import { AiBriefingModal } from "./components/AiBriefingModal";
import { CitizenReportModal } from "./components/CitizenReportModal";
import { LOCATIONS } from "./components/CitySelector";
import { LiveTimelineBar, type PerformanceTier } from "./components/LiveTimelineBar";
import { MapView, type VisionMode } from "./components/MapView";
import {
  type AlertFeedStatus,
  type ClientAlertDetail,
  type ClientAlertHistoryItem,
  type ClientAlertState,
  type FilterState,
  type TacticalFilters
} from "./types";
import { TacticalTopBar } from "./components/TacticalTopBar";
import { TacticalMenuModal } from "./components/TacticalMenuModal";
import { ImpactCard } from "./components/ImpactCard";
import { TargetCard } from "./components/TargetCard";
import { LocationCard } from "./components/LocationCard";
import { LiveThreatDrawer } from "./components/LiveThreatDrawer";
import { type ImpactEvent, type TrackPacket, useWsRadar } from "./hooks/useWsRadar";
import { haversineMeters } from "./lib/geo";
import { soundEngine } from "./lib/sound";
import { useTrustedLocation } from "./location/useTrustedLocation";
import { LocationSetupModal, type ConfirmedLocation } from "./components/LocationSetupModal";
import { detectHardwareTier } from "./lib/hardwareBenchmark.js";
import { trackStore, isCivilAviation } from "./lib/trackStore.js";

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

const ALERTS_CACHE_KEY = "eye-radar-last-alerts-v1";
const UI_PREFS_STORAGE_KEY = "eye-radar-ui-prefs-v1";
const ALERTS_STALE_MS = 3 * 60 * 1000;
const CLOUD_ALERTS_FALLBACK_URL = "https://eye-radar.onrender.com/api/alerts";

interface StoredUiPrefs {
  visionMode?: VisionMode;
  threatOnly?: boolean;
  showFrontline?: boolean;
  showFirms?: boolean;
  showAviation?: boolean;
  showAlerts?: boolean;
  showUncertainty?: boolean;
  filters?: Partial<FilterState>;
}

const loadStoredUiPrefs = (): StoredUiPrefs => {
  try {
    const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as StoredUiPrefs;
    }
  } catch {}
  return {};
};

const formatAlertDuration = (startedAt?: number): string | null => {
  if (!startedAt || !Number.isFinite(startedAt)) return null;
  const elapsedMin = Math.max(1, Math.round((Date.now() - startedAt) / 60_000));
  const timeStr = new Date(startedAt).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  if (elapsedMin < 60) return `з ${timeStr} · ${elapsedMin} хв`;
  const hours = Math.floor(elapsedMin / 60);
  const mins = elapsedMin % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `тривала (${days} дн.)`;
  }
  return `з ${timeStr} · ${hours} год ${mins} хв`;
};

const loadCachedAlertState = (): ClientAlertState => {
  try {
    const raw = localStorage.getItem(ALERTS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ClientAlertState>;
      if (Array.isArray(parsed.activeAlerts) && typeof parsed.lastConfirmedAt === "number" && parsed.lastConfirmedAt > 0) {
        return {
          activeAlerts: parsed.activeAlerts.filter((v): v is string => typeof v === "string"),
          status: "stale",
          source: typeof parsed.source === "string" ? parsed.source : "alerts.in.ua",
          sourceAvailable: false,
          lastConfirmedAt: parsed.lastConfirmedAt
        };
      }
    }
  } catch {}
  return {
    activeAlerts: [],
    status: "unavailable",
    source: "alerts.in.ua",
    sourceAvailable: false,
    lastConfirmedAt: null
  };
};

const formatAlertConfirmedTime = (ts: number | null): string => {
  if (!ts) return "невідомо";
  const time = new Date(ts).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const ageSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  const ageStr = ageSec < 60 ? `${ageSec} с тому` : `${Math.round(ageSec / 60)} хв тому`;
  return `${time} (${ageStr})`;
};

export const App = () => {
  const userId = useMemo(getUserId, []);
  const {
    location,
    confirmedLocation,
    isConfirmed,
    isManual,
    trustScore,
    flags,
    needsManualConfirm,
    setManualLocation,
    saveUserLocation,
    resetToGps
  } = useTrustedLocation();
  const [isPickingLocation, setIsPickingLocation] = useState(false);
  const [locationSetupOpen, setLocationSetupOpen] = useState(false);
  const { packets, impacts, uncertaintyEvents, connectionState, mapStyleUrl, pmtilesUrl } = useWsRadar(
    userId,
    location,
    trustScore,
    flags
  );

  const storedPrefs = useMemo(loadStoredUiPrefs, []);
  const [mapInstance, setMapInstance] = useState<Map | null>(null);
  const [visionMode, setVisionMode] = useState<VisionMode>(
    storedPrefs.visionMode === "tactical" ||
      storedPrefs.visionMode === "nvg" ||
      storedPrefs.visionMode === "flir" ||
      storedPrefs.visionMode === "satellite"
      ? storedPrefs.visionMode
      : "satellite"
  );
  const [selectedTarget, setSelectedTarget] = useState<TrackPacket | null>(null);
  const [inspectedTarget, setInspectedTarget] = useState<TrackPacket | null>(null);
  const [selectedImpact, setSelectedImpact] = useState<ImpactEvent | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [tacticalMenuOpen, setTacticalMenuOpen] = useState(false);
  const [threatOnly, setThreatOnly] = useState(Boolean(storedPrefs.threatOnly));
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [selectedCityName, setSelectedCityName] = useState<string>("");
  const [alertState, setAlertState] = useState<ClientAlertState>(loadCachedAlertState);
  const [alertSearchQuery, setAlertSearchQuery] = useState<string>("");
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine === false : false
  );
  const [lastDataSyncAt, setLastDataSyncAt] = useState<number>(() => Date.now());
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const activeAlerts = alertState.activeAlerts;
  const [showWeather, setShowWeather] = useState(false);
  const [showSatellites, setShowSatellites] = useState(false);
  const [followedTargetId, setFollowedTargetId] = useState<string | null>(null);
  const [alertsModalOpen, setAlertsModalOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [timelineOffsetSec, setTimelineOffsetSec] = useState<number>(0);
  const [performanceTier, setPerformanceTier] = useState<PerformanceTier>(() => detectHardwareTier());

  // Load saved performance tier from localStorage if present
  useEffect(() => {
    try {
      const saved = localStorage.getItem("performanceTier");
      if (saved === "LOW" || saved === "NORMAL" || saved === "HIGH") {
        setPerformanceTier(saved as PerformanceTier);
      }
    } catch {}
  }, []);

  // Persist tier changes and sync with trackStore
  useEffect(() => {
    try {
      localStorage.setItem("performanceTier", performanceTier);
    } catch {}
    trackStore.setTier(performanceTier);
  }, [performanceTier]);

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
    autoTracking: false,
    minSpeedKmh: 0,
    maxSpeedKmh: 2500,
    threatOnly: true,
    dangerRadiusKm: 35,
    showWind: false
  });

  const [filters, setFilters] = useState<FilterState>({
    uav: storedPrefs.filters?.uav ?? true,
    munition: storedPrefs.filters?.munition ?? true,
    bomb: storedPrefs.filters?.bomb ?? true,
    fpv: storedPrefs.filters?.fpv ?? true,
    aircraft: storedPrefs.filters?.aircraft ?? true,
    helicopter: storedPrefs.filters?.helicopter ?? true,
    sound: soundEngine.isSoundEnabled()
  });

  const [showFrontline, setShowFrontline] = useState(storedPrefs.showFrontline ?? true);
  const [showFirms, setShowFirms] = useState(storedPrefs.showFirms ?? true);
  const [showAviation, setShowAviation] = useState(storedPrefs.showAviation ?? false);
  const [showAlerts, setShowAlerts] = useState(storedPrefs.showAlerts ?? true);
  const [showUncertainty, setShowUncertainty] = useState(storedPrefs.showUncertainty ?? true);
  const [currentZoom, setCurrentZoom] = useState(5.5);

  // Persist user UI preferences across sessions
  useEffect(() => {
    try {
      const toSave: StoredUiPrefs = {
        visionMode,
        threatOnly,
        showFrontline,
        showFirms,
        showAviation,
        showAlerts,
        showUncertainty,
        filters
      };
      localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(toSave));
    } catch {}
  }, [visionMode, threatOnly, showFrontline, showFirms, showAviation, showAlerts, showUncertainty, filters]);

  // Monitor browser online/offline state & data freshness tick
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const timer = setInterval(() => setNowTick(Date.now()), 5_000);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (packets.length > 0 || connectionState === "open") {
      setLastDataSyncAt(Date.now());
    }
  }, [packets, connectionState]);

  useEffect(() => {
    try {
      window.Telegram?.WebApp?.ready();
      window.Telegram?.WebApp?.expand();
      window.Telegram?.WebApp?.setHeaderColor?.("#0b1220");
      window.Telegram?.WebApp?.setBackgroundColor?.("#070b14");
      // Fullscreen on supported Telegram Bot API 8.0+ clients only
      const tgApp = window.Telegram?.WebApp as any;
      if (tgApp?.isVersionAtLeast?.("8.0")) {
        tgApp?.requestFullscreen?.();
      }
      // Prevent accidental swipe-down close on map drag
      if (tgApp?.isVersionAtLeast?.("7.7")) {
        tgApp?.disableVerticalSwipes?.();
      }
    } catch {}
  }, []);

  // Fetch official air raid alerts; loss of source connection NEVER wipes last confirmed state (unknown != all-clear!)
  useEffect(() => {
    let unmounted = false;

    const fetchAlerts = async () => {
      try {
        const res = await fetch("/api/alerts", { signal: AbortSignal.timeout(5000) }).catch(() =>
          fetch(CLOUD_ALERTS_FALLBACK_URL, { signal: AbortSignal.timeout(5000) })
        );
        if (!res || !res.ok) {
          throw new Error(`HTTP ${res?.status ?? 0}`);
        }
        const data = (await res.json()) as {
          status?: AlertFeedStatus;
          source?: string;
          sourceAvailable?: boolean;
          stale?: boolean;
          lastConfirmedAt?: number | null;
          updatedAt?: number;
          alerts?: Array<{ active: boolean; name: string; startedAt?: number; changedAt?: string }>;
          history?: ClientAlertHistoryItem[];
        };
        if (unmounted) return;
        setLastDataSyncAt(Date.now());

        const serverConfirmedAt =
          typeof data.lastConfirmedAt === "number" && data.lastConfirmedAt > 0
            ? data.lastConfirmedAt
            : typeof data.updatedAt === "number" && data.updatedAt > 0
            ? data.updatedAt
            : null;
        const activeItems = Array.isArray(data.alerts) ? data.alerts.filter((a) => a.active) : [];
        const serverAlerts = activeItems.map((a) => a.name);
        const alertDetails: Record<string, ClientAlertDetail> = {};
        for (const item of activeItems) {
          alertDetails[item.name] = {
            name: item.name,
            startedAt: item.startedAt,
            changedAt: item.changedAt
          };
        }
        const serverHistory = Array.isArray(data.history) ? data.history.slice(0, 20) : undefined;
        const serverStatus: AlertFeedStatus =
          data.status === "fresh" || data.status === "stale" || data.status === "unavailable"
            ? data.status
            : serverConfirmedAt
            ? Date.now() - serverConfirmedAt > ALERTS_STALE_MS || data.stale
              ? "stale"
              : "fresh"
            : "unavailable";

        setAlertState((prev) => {
          // If server has no confirmed state yet ("unavailable"), retain any previously confirmed local state as "stale"
          if (serverStatus === "unavailable" && prev.lastConfirmedAt) {
            return {
              ...prev,
              status: "stale",
              sourceAvailable: false
            };
          }
          const next: ClientAlertState = {
            activeAlerts: serverAlerts,
            alertDetails,
            history: serverHistory ?? prev.history,
            status: serverStatus,
            source: data.source || prev.source || "alerts.in.ua",
            sourceAvailable: data.sourceAvailable ?? serverStatus === "fresh",
            lastConfirmedAt: serverConfirmedAt
          };
          if (serverConfirmedAt) {
            try {
              localStorage.setItem(ALERTS_CACHE_KEY, JSON.stringify(next));
            } catch {}
          }
          return next;
        });
      } catch {
        if (unmounted) return;
        // Network/API outage: preserve last confirmed alerts & mark state stale/unknown (NEVER clear to all-clear!)
        setAlertState((prev) => {
          const hasConfirmed = prev.lastConfirmedAt !== null && prev.lastConfirmedAt > 0;
          const isOld = hasConfirmed && Date.now() - (prev.lastConfirmedAt ?? 0) > ALERTS_STALE_MS;
          return {
            ...prev,
            sourceAvailable: false,
            status: hasConfirmed ? (isOld || prev.status !== "fresh" ? "stale" : "stale") : "unavailable"
          };
        });
      }
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

      const isCivil = isCivilAviation(p);

      // Civilian commercial flights are hidden when threatOnly is active or showAviation is disabled
      // Strictly preserves all military targets (combat aircraft, UAVs, missiles, bombs, FPV, allied transports/tankers)
      if (isCivil && (tacticalFilters.threatOnly || threatOnly || !showAviation)) {
        return false;
      }

      if (type === "uav" && !filters.uav) return false;
      if (type === "munition" && !filters.munition) return false;
      if (type === "bomb" && filters.bomb === false) return false;
      if (type === "fpv" && filters.fpv === false) return false;
      if (type === "aircraft") {
        if (!filters.aircraft && isCivil) {
          if (currentZoom >= 6.5) return false;
        }
      }
      if (type === "helicopter" && filters.helicopter === false && isCivil) return false;

      return true;
    });
  }, [packets, tacticalFilters, threatOnly, showAviation, filters, currentZoom]);

  // ── Auto-Sentinel: Proximity monitoring without unwanted auto-selection ───
  useEffect(() => {
    if (!tacticalFilters.autoTracking || !location || filteredPackets.length === 0) {
      return;
    }
    // Target designation and telemetry info must ONLY be displayed when explicitly tapped by the user!
  }, [filteredPackets, location, tacticalFilters]);

  const targetCounts = useMemo(() => {
    let uav = 0;
    let munition = 0;
    let bomb = 0;
    let fpv = 0;
    let aircraft = 0;
    let militaryAircraft = 0;
    let helo = 0;
    for (const p of packets) {
      const type = p[1];
      const isCivil = isCivilAviation(p);
      if (type === "uav") uav++;
      else if (type === "munition") munition++;
      else if (type === "bomb") bomb++;
      else if (type === "fpv") fpv++;
      else if (type === "aircraft") {
        aircraft++;
        if (!isCivil) militaryAircraft++;
      } else if (type === "helicopter") helo++;
    }
    return { uav, munition, bomb, fpv, aircraft, militaryAircraft, helo };
  }, [packets]);

  const threatCount = useMemo(() => {
    return filteredPackets.filter((p) => {
      const type = p[1];
      const isCivil = isCivilAviation(p);
      return type === "uav" || type === "munition" || type === "bomb" || type === "fpv" || !isCivil;
    }).length;
  }, [filteredPackets]);

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

  const handleConfirmLocation = (newLoc: ConfirmedLocation) => {
    saveUserLocation(newLoc);
    setLocationSetupOpen(false);
    if (mapInstance) {
      const isOverview = newLoc.name.includes("Вся Україна") || Math.abs(newLoc.lat - 48.9) < 0.3;
      const isMobile = typeof window !== "undefined" && window.innerWidth < 600;
      mapInstance.flyTo({
        center: [newLoc.lon, newLoc.lat],
        zoom: isOverview ? (isMobile ? 4.0 : 5.0) : 7.0,
        pitch: 0,
        bearing: 0,
        duration: 1200
      });
    }
  };

  const handlePickLocation = (lat: number, lon: number) => {
    const customLoc: ConfirmedLocation = {
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      name: "Точка на карті",
      region: "Власна геопозиція"
    };
    saveUserLocation(customLoc);
    setIsPickingLocation(false);
    if (mapInstance) {
      mapInstance.flyTo({
        center: [lon, lat],
        zoom: 9.5,
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
      zoom: 9.5,
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
        threatCount={threatCount}
        totalTracksCount={filteredPackets.length}
        activeAlertsCount={activeAlerts.length}
        alertStatus={alertState.status}
        alertsUpdatedAt={alertState.lastConfirmedAt}
        uncertaintyCount={uncertaintyEvents.length}
        connectionState={connectionState}
        onOpenMenu={() => setTacticalMenuOpen(true)}
        onOpenReport={() => setReportOpen(true)}
        onOpenAlerts={() => setAlertsModalOpen(true)}
      />



      {/* 1b. Weak connection / Offline / Stale telemetry indicator strip */}
      {(isOffline || connectionState === "closed" || nowTick - lastDataSyncAt > 60_000) && (
        <div className="network-stale-strip" role="status">
          <span className="stale-strip-dot" />
          <span className="stale-strip-text">
            {isOffline
              ? "Автономний режим (без інтернету) · Карта PMTiles активна, показано останній збережений стан (НЕ відбій)"
              : `Зв'язок ослаблений · Дані оновлено ${Math.max(1, Math.round((nowTick - lastDataSyncAt) / 1000))} с тому (останній стан збережено)`}
          </span>
        </div>
      )}

      {/* 2. Live Tactical Timeline & Performance Optimizer Bar */}
      <LiveTimelineBar
        selectedOffsetSec={timelineOffsetSec}
        onSelectOffset={setTimelineOffsetSec}
        performanceTier={performanceTier}
        onSelectTier={setPerformanceTier}
      />

      {/* 3. Full-screen map (edge to edge, clean, zero watermarks) */}
      <ErrorBoundary>
        <MapView
          packets={filteredPackets}
          impacts={impacts}
          mapStyleUrl={mapStyleUrl}
          pmtilesUrl={pmtilesUrl}
          preferLocalPmtiles={isOffline}
          location={location}
          confirmedLocation={confirmedLocation}
          filters={filters}
          visionMode={visionMode}
          selectedTarget={selectedTarget}
          selectedImpact={selectedImpact}
          selectedLocation={selectedLocation}
          isPickingLocation={isPickingLocation}
          showDayNight={true}
          showWeather={showWeather}
          showSatellites={showSatellites}
          showFrontline={showFrontline}
          showFirms={showFirms}
          showAviation={showAviation}
          showAlerts={showAlerts}
          showUncertainty={showUncertainty}
          followingTargetId={followedTargetId}
          timelineOffsetSec={timelineOffsetSec}
          performanceTier={performanceTier}
          activeAlerts={activeAlerts}
          alertStatus={alertState.status}
          onStopFollow={() => setFollowedTargetId(null)}
          onMapReady={(m) => {
            setMapInstance(m);
            (window as any).__eyeRadarMap = m;
            setCurrentZoom(m.getZoom());
            m.on("zoom", () => {
              setCurrentZoom(m.getZoom());
            });
          }}
          onPickLocation={handlePickLocation}
          onSelectTarget={(target) => {
            const isSame = selectedTarget && selectedTarget[0] === target[0];
            setSelectedTarget(isSame ? null : target);
            setInspectedTarget(isSame ? null : target);
            setSelectedImpact(null);
            setSelectedLocation(null);
          }}
          onSelectImpact={(event) => {
            setSelectedImpact(event);
            setSelectedTarget(null);
            setInspectedTarget(null);
            setSelectedLocation(null);
          }}
          onSelectLocation={() => {
            setSelectedTarget(null);
            setSelectedLocation(null);
            setInspectedTarget(null);
            setSelectedImpact(null);
          }}
        />
      </ErrorBoundary>

      {/* Live Interactive Threat Feed Dock (Bottom-Left) */}
      <LiveThreatDrawer
        packets={filteredPackets}
        location={location}
        selectedTargetId={selectedTarget?.[0] ?? null}
        onSelectTarget={(packet) => {
          setSelectedTarget(packet);
          setInspectedTarget(packet);
          setSelectedImpact(null);
          setSelectedLocation(null);
          mapInstance?.flyTo({
            center: [packet[3], packet[2]],
            zoom: Math.max(mapInstance.getZoom(), 9.2),
            duration: 950
          });
        }}
        onFitAll={handleFitAllTargets}
      />

      {/* Floating "Моя локація" / Locator Button on Map */}
      {location && (
        <button
          type="button"
          className="floating-my-location-btn"
          onClick={handleFlyToUser}
          title="Фокус на моїй закріпленій локації"
        >
          <span className="locator-icon">◎</span>
          <span className="locator-text">МОЯ ЛОКАЦІЯ</span>
        </button>
      )}

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
        showFrontline={showFrontline}
        onToggleFrontline={() => setShowFrontline((prev) => !prev)}
        showFirms={showFirms}
        onToggleFirms={() => setShowFirms((prev) => !prev)}
        showAviation={showAviation}
        onToggleAviation={() => setShowAviation((prev) => !prev)}
        showAlerts={showAlerts}
        onToggleAlerts={() => setShowAlerts((prev) => !prev)}
        showUncertainty={showUncertainty}
        onToggleUncertainty={() => setShowUncertainty((prev) => !prev)}
        soundEnabled={filters.sound !== false}
        onToggleSound={() => handleToggleFilter("sound")}
        filters={filters}
        onToggleFilter={handleToggleFilter}
        threatOnly={threatOnly}
        onToggleThreatOnly={() => setThreatOnly((prev) => !prev)}
        uavCount={targetCounts.uav}
        munitionCount={targetCounts.munition}
        bombCount={targetCounts.bomb}
        fpvCount={targetCounts.fpv}
        aircraftCount={targetCounts.aircraft}
        heloCount={targetCounts.helo}
        totalTrackCount={filteredPackets.length}
        onFitAllTargets={handleFitAllTargets}
        location={location}
        confirmedLocation={confirmedLocation}
        isManual={isManual}
        isPickingLocation={isPickingLocation}
        onTogglePickLocation={() => setIsPickingLocation((prev) => !prev)}
        onResetGps={resetToGps}
        onOpenChangeLocation={() => setLocationSetupOpen(true)}
        onFlyToUser={handleFlyToUser}
        onSelectCity={handleSelectCity}
        impacts={impacts}
        onFlyToCoord={(lat, lon) => {
          mapInstance?.flyTo({ center: [lon, lat], zoom: 12.5, duration: 1200 });
        }}
        onOpenBriefing={() => setBriefingOpen(true)}
        onOpenReport={() => setReportOpen(true)}
        activeAlerts={activeAlerts}
        alertStatus={alertState.status}
        alertsUpdatedAt={alertState.lastConfirmedAt}
      />

      {/* 4. Active Target Flyout Card (dynamically updated with live telemetry) */}
      {(() => {
        const liveTarget = inspectedTarget
          ? filteredPackets.find((p) => p[0] === inspectedTarget[0]) ?? inspectedTarget
          : null;
        return liveTarget ? (
          <TargetCard
            packet={liveTarget}
            location={location}
            onClose={() => {
              setInspectedTarget(null);
              setSelectedTarget(null);
            }}
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
        ) : null;
      })()}

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
          alertStatus={alertState.status}
          alertsUpdatedAt={alertState.lastConfirmedAt}
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

      {/* 7. Official Alerts Modal (fresh, stale last-confirmed, or unavailable — never misrepresents outage as all-clear) */}
      {alertsModalOpen && (
        <div className="alerts-modal-overlay" onClick={() => setAlertsModalOpen(false)}>
          <div
            className={`alerts-modal-card ${
              alertState.status !== "fresh" ? "alerts-modal-stale" : activeAlerts.length === 0 ? "alerts-modal-calm" : ""
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="alerts-modal-header">
              <div className="alerts-modal-title">
                <span className="ticker-icon">
                  {alertState.status !== "fresh" ? "⚠️" : activeAlerts.length > 0 ? "🚨" : "🛡️"}
                </span>
                <strong>
                  {alertState.status === "unavailable"
                    ? "СТАН ТРИВОГ НЕВІДОМИЙ"
                    : alertState.status === "stale"
                    ? `ОСТАННІЙ ПІДТВЕРДЖЕНИЙ СТАН (${activeAlerts.length})`
                    : activeAlerts.length > 0
                    ? `ПОВІТРЯНІ ТРИВОГИ В УКРАЇНІ (${activeAlerts.length})`
                    : "ОФІЦІЙНИХ ТРИВОГ НЕ ОГОЛОШЕНО"}
                </strong>
              </div>
              <button
                type="button"
                className="alerts-modal-close"
                onClick={() => setAlertsModalOpen(false)}
              >
                ✕
              </button>
            </div>

            {alertState.status !== "fresh" && (
              <div className="alerts-stale-banner">
                <strong>Втрачено зв'язок із джерелом тривог — це НЕ відбій!</strong>
                <span>
                  {alertState.status === "stale" && alertState.lastConfirmedAt
                    ? `Поточний стан невідомий. Показано останній підтверджений стан від ${formatAlertConfirmedTime(alertState.lastConfirmedAt)}. Перевірте офіційні канали ДСНС / обласної ОВА.`
                    : "Поточний стан офіційних тривог невідомий. Орієнтуйтесь на сирени та офіційні канали ДСНС / обласної ОВА."}
                </span>
              </div>
            )}

            {activeAlerts.length > 0 ? (
              <>
                <div className="alerts-search-box">
                  <input
                    type="text"
                    className="alerts-search-input"
                    placeholder="Пошук області або швидкий перехід..."
                    value={alertSearchQuery}
                    onChange={(e) => setAlertSearchQuery(e.target.value)}
                  />
                </div>
                <div className="alerts-modal-sub">
                  {alertState.status === "stale"
                    ? "Останні підтверджені області з тривогою (натисніть для переходу):"
                    : "Натисніть на область для миттєвого переходу камери:"}
                </div>
                <div className="alerts-regions-grid">
                  {activeAlerts
                    .filter((r) =>
                      !alertSearchQuery.trim() ||
                      r.toLowerCase().includes(alertSearchQuery.trim().toLowerCase())
                    )
                    .map((regionName) => {
                      const detail = alertState.alertDetails?.[regionName];
                      const durationLabel = formatAlertDuration(detail?.startedAt);
                      return (
                        <button
                          key={regionName}
                          type="button"
                          className={`alert-region-chip ${alertState.status !== "fresh" ? "stale-chip" : ""}`}
                          onClick={() => {
                            window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
                            handleSelectOblastFromAlert(regionName);
                            setAlertsModalOpen(false);
                          }}
                        >
                          <span className="alert-beacon-dot" />
                          <span className="alert-region-chip-body">
                            <span className="alert-region-text">{regionName}</span>
                            {durationLabel && <span className="alert-region-duration">{durationLabel}</span>}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </>
            ) : (
              <div className="alerts-modal-empty">
                {alertState.status === "fresh"
                  ? "На момент останнього офіційного оновлення повітряних тривог в областях України не зафіксовано."
                  : alertState.status === "stale"
                  ? "На момент останнього підтвердження тривог не було, але зв'язок із джерелом втрачено — орієнтуйтесь на офіційні сирени."
                  : "Немає підтверджених даних від джерела офіційних тривог."}
              </div>
            )}

            {alertState.history && alertState.history.length > 0 && (
              <div className="alerts-history-section">
                <div className="alerts-history-title">ІСТОРІЯ ОФІЦІЙНИХ СПОВІЩЕНЬ</div>
                <div className="alerts-history-list">
                  {alertState.history.slice(0, 5).map((h, idx) => (
                    <div key={`${h.oblast}-${h.recordedAt}-${idx}`} className="alerts-history-row">
                      <span className={`history-badge ${h.eventType === "alert_start" ? "start" : "clear"}`}>
                        {h.eventType === "alert_start" ? "ТРИВОГА" : "ВІДБІЙ"}
                      </span>
                      <span className="history-oblast">{h.oblast}</span>
                      <span className="history-time">
                        {new Date(h.recordedAt).toLocaleTimeString("uk-UA", {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="alerts-modal-footer">
              <span>Джерело: {alertState.source}</span>
              <span>Підтверджено: {formatAlertConfirmedTime(alertState.lastConfirmedAt)}</span>
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

      <LocationSetupModal
        isOpen={locationSetupOpen}
        onClose={() => setLocationSetupOpen(false)}
        currentLocation={confirmedLocation}
        onConfirmLocation={handleConfirmLocation}
        onStartPickOnMap={() => {
          setIsPickingLocation(true);
          setLocationSetupOpen(false);
        }}
        isFirstLaunch={!isConfirmed}
      />
    </main>
  );
};

export default App;
