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

  const CANONICAL_DEFAULT_LOCATION: TrustedLocation = {
    lat: 50.4501,
    lon: 30.5234,
    accuracy: 15,
    timestamp: Date.now()
  };

  const [location, setLocation] = useState<TrustedLocation>(() => {
    if (confirmedLocation) {
      return {
        lat: confirmedLocation.lat,
        lon: confirmedLocation.lon,
        accuracy: 15,
        timestamp: Date.now()
      };
    }
    return CANONICAL_DEFAULT_LOCATION;
  });

  const [trustScore, setTrustScore] = useState(100);
  const [flags, setFlags] = useState<string[]>([]);
  const [isDegraded, setIsDegraded] = useState(false);
  const [isSpoofed, setIsSpoofed] = useState(false);
  const [trustStatus, setTrustStatus] = useState<"TRUSTED" | "DEGRADED" | "SPOOFED_FALLBACK">("TRUSTED");
  const [needsManualConfirm, setNeedsManualConfirm] = useState(!isConfirmed);
  const previousRef = useRef<RawLocationSample | null>(null);
  const lastTrustedLocationRef = useRef<TrustedLocation | null>(location);
  const [isManual, setIsManual] = useState(Boolean(confirmedLocation));
  const lastGpsRef = useRef<TrustedLocation | null>(null);

  // Sync saved location from Neon PostgreSQL
  useEffect(() => {
    const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    const userId = tgUserId || localStorage.getItem("eye-radar-user-id");
    const locUrl = userId ? `/api/location?userId=${userId}` : "/api/location";

    fetch(locUrl)
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok && data?.location?.lat && data?.location?.lon) {
          const loc = {
            lat: data.location.lat,
            lon: data.location.lon,
            name: data.location.name || "Збережена локація"
          };
          localStorage.setItem("eye-radar-user-location", JSON.stringify(loc));
          localStorage.setItem("eye-radar-user-location-confirmed", "true");
          setConfirmedLocation(loc);
          setIsConfirmed(true);
          setLocation({
            lat: loc.lat,
            lon: loc.lon,
            accuracy: data.location.accuracy || 15,
            timestamp: Date.now()
          });
          setIsManual(true);
          setNeedsManualConfirm(false);
        }
      })
      .catch(() => {});
  }, []);

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

        const isInsideUkraine =
          sample.lat >= 44.0 && sample.lat <= 52.5 && sample.lon >= 22.0 && sample.lon <= 40.5;

        const anomaly = detectLocationAnomaly(
          previousRef.current,
          sample,
          confirmedLocation ? { lat: confirmedLocation.lat, lon: confirmedLocation.lon } : null
        );

        if (!isInsideUkraine) {
          anomaly.isSpoofed = true;
          anomaly.isDegraded = true;
          if (!anomaly.flags.includes("foreign_vpn_or_spoofing")) {
            anomaly.flags.push("foreign_vpn_or_spoofing");
          }
          anomaly.trustScore = Math.min(anomaly.trustScore, 30);
        }

        setTrustScore(anomaly.trustScore);
        setFlags(anomaly.flags);
        setIsDegraded(anomaly.isDegraded);
        setIsSpoofed(anomaly.isSpoofed);

        if (!isManual && !confirmedLocation) {
          // If EW/spoofing is detected or coordinates degraded, freeze lastTrustedLocation or fall back to canonical default
          if (anomaly.isSpoofed || anomaly.isDegraded) {
            setTrustStatus(anomaly.isSpoofed ? "SPOOFED_FALLBACK" : "DEGRADED");
            setNeedsManualConfirm(true);
            if (lastTrustedLocationRef.current && isInsideUkraine) {
              setLocation(lastTrustedLocationRef.current);
            } else {
              setLocation(CANONICAL_DEFAULT_LOCATION);
            }
            return;
          }

          // Healthy GNSS sample inside Ukraine
          previousRef.current = sample;
          lastTrustedLocationRef.current = gpsLoc;
          setTrustStatus("TRUSTED");
          setNeedsManualConfirm(false);
          setLocation(gpsLoc);
        } else if (confirmedLocation) {
          setLocation({
            lat: confirmedLocation.lat,
            lon: confirmedLocation.lon,
            accuracy: 15,
            timestamp: Date.now()
          });
        }
      },
      () => {
        if (!isManual && confirmedLocation) {
          setLocation({
            lat: confirmedLocation.lat,
            lon: confirmedLocation.lon,
            accuracy: 50,
            timestamp: Date.now()
          });
        }
        setIsDegraded(true);
        setTrustStatus("DEGRADED");
        setNeedsManualConfirm(true);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3_000,
        timeout: 10_000
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [confirmedLocation, isManual]);

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

      // Sync to Neon Postgres user_preferences / alerts subscription
      const tgUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
      const userId = tgUserId || localStorage.getItem("eye-radar-user-id");
      if (userId) {
        void fetch("/api/location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            lat: loc.lat,
            lon: loc.lon,
            name: loc.name,
            cityName: loc.name,
            accuracy: 15,
            source: "manual",
            trusted: true,
            radiusKm: 35
          })
        }).catch(() => {});
      }
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
      isDegraded,
      isSpoofed,
      trustStatus,
      needsManualConfirm,
      setManualLocation,
      saveUserLocation,
      resetToGps
    }),
    [
      confirmedLocation,
      flags,
      isConfirmed,
      isDegraded,
      isManual,
      isSpoofed,
      location,
      needsManualConfirm,
      resetToGps,
      saveUserLocation,
      setManualLocation,
      trustScore,
      trustStatus
    ]
  );
};

