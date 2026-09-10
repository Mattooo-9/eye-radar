import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectLocationAnomaly, type RawLocationSample } from "./anomaly";

export interface TrustedLocation {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
}

export interface ManualLocationInput {
  lat: number;
  lon: number;
}

interface IpFallbackResponse {
  fallback: {
    lat?: number;
    lon?: number;
    city?: string;
    country?: string;
  } | null;
}

export const useTrustedLocation = () => {
  const [confirmedLocation, setConfirmedLocation] = useState<{
    lat: number;
    lon: number;
    name: string;
    region?: string;
  } | null>(() => {
    try {
      const raw = localStorage.getItem("eye-radar-user-location");
      return raw ? (JSON.parse(raw) as { lat: number; lon: number; name: string; region?: string }) : null;
    } catch {
      return null;
    }
  });

  const [isConfirmed, setIsConfirmed] = useState<boolean>(() => {
    return Boolean(localStorage.getItem("eye-radar-user-location-confirmed"));
  });

  const [location, setLocation] = useState<TrustedLocation | null>(() => {
    if (confirmedLocation) {
      return {
        lat: confirmedLocation.lat,
        lon: confirmedLocation.lon,
        accuracy: 15,
        timestamp: Date.now()
      };
    }
    return null;
  });

  const [coarseLocation, setCoarseLocation] = useState<TrustedLocation | null>(null);
  const [trustScore, setTrustScore] = useState(100);
  const [flags, setFlags] = useState<string[]>([]);
  const [needsManualConfirm, setNeedsManualConfirm] = useState(!isConfirmed);
  const previousRef = useRef<RawLocationSample | null>(null);
  const [isManual, setIsManual] = useState(Boolean(confirmedLocation));
  const lastGpsRef = useRef<TrustedLocation | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setNeedsManualConfirm(true);
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const sample: RawLocationSample = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          heading: position.coords.heading,
          timestamp: position.timestamp
        };

        const gpsLoc: TrustedLocation = {
          lat: sample.lat,
          lon: sample.lon,
          accuracy: sample.accuracy,
          timestamp: sample.timestamp
        };
        lastGpsRef.current = gpsLoc;

        const anomaly = detectLocationAnomaly(previousRef.current, sample, coarseLocation);
        previousRef.current = sample;

        setTrustScore(anomaly.trustScore);
        setFlags(anomaly.flags);

        if (!isManual) {
          if (anomaly.trustScore < 55 && coarseLocation) {
            setLocation(coarseLocation);
            setNeedsManualConfirm(true);
            return;
          }

          setNeedsManualConfirm(anomaly.trustScore < 55);
          setLocation(gpsLoc);
        }
      },
      () => {
        if (!isManual && coarseLocation) {
          setLocation(coarseLocation);
        }
        setNeedsManualConfirm(true);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 4_000,
        timeout: 12_000
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [coarseLocation, isManual]);

  const setManualLocation = useCallback((value: ManualLocationInput) => {
    const manualLocation = {
      lat: value.lat,
      lon: value.lon,
      accuracy: 15,
      timestamp: Date.now()
    };

    previousRef.current = {
      ...manualLocation,
      speed: 0,
      heading: null
    };
    setIsManual(true);
    setLocation(manualLocation);
    setNeedsManualConfirm(false);
    setTrustScore(80);
    setFlags((current) => [...current.filter((flag) => flag !== "manual_override"), "manual_override"]);
  }, []);

  const resetToGps = useCallback(() => {
    setIsManual(false);
    if (lastGpsRef.current) {
      setLocation(lastGpsRef.current);
      setTrustScore(95);
      setFlags((current) => current.filter((flag) => flag !== "manual_override"));
    }
  }, []);

  // Sync confirmed coordinates to Telegram Bot alert preferences
  useEffect(() => {
    if (!location) return;
    const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    if (!tgUserId) return;

    const timer = setTimeout(() => {
      void fetch("/api/alerts/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: tgUserId,
          lat: location.lat,
          lon: location.lon,
          cityName: confirmedLocation?.name,
          radiusKm: 35
        })
      }).catch(() => {});
    }, 1500);

    return () => clearTimeout(timer);
  }, [confirmedLocation?.name, location?.lat, location?.lon]);

  const saveUserLocation = useCallback(
    (loc: { lat: number; lon: number; name: string; region?: string }) => {
      try {
        localStorage.setItem("eye-radar-user-location", JSON.stringify(loc));
        localStorage.setItem("eye-radar-user-location-confirmed", "true");
      } catch {}
      setConfirmedLocation(loc);
      setIsConfirmed(true);
      setManualLocation({ lat: loc.lat, lon: loc.lon });
      setNeedsManualConfirm(false);
    },
    [setManualLocation]
  );

  return useMemo(
    () => ({
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
    }),
    [
      confirmedLocation,
      flags,
      isConfirmed,
      isManual,
      location,
      needsManualConfirm,
      resetToGps,
      saveUserLocation,
      setManualLocation,
      trustScore
    ]
  );
};

