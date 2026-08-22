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
  const [location, setLocation] = useState<TrustedLocation | null>(null);
  const [coarseLocation, setCoarseLocation] = useState<TrustedLocation | null>(null);
  const [trustScore, setTrustScore] = useState(100);
  const [flags, setFlags] = useState<string[]>([]);
  const [needsManualConfirm, setNeedsManualConfirm] = useState(false);
  const previousRef = useRef<RawLocationSample | null>(null);

  useEffect(() => {
    const loadCoarse = async (): Promise<void> => {
      try {
        const response = await fetch("/api/location/ip");
        const data = (await response.json()) as IpFallbackResponse;
        if (data.fallback?.lat && data.fallback?.lon) {
          setCoarseLocation({
            lat: Number(data.fallback.lat),
            lon: Number(data.fallback.lon),
            accuracy: 50_000,
            timestamp: Date.now()
          });
        }
      } catch {
        setCoarseLocation(null);
      }
    };

    void loadCoarse();
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

        const anomaly = detectLocationAnomaly(previousRef.current, sample, coarseLocation);
        previousRef.current = sample;

        setTrustScore(anomaly.trustScore);
        setFlags(anomaly.flags);

        if (anomaly.trustScore < 55 && coarseLocation) {
          setLocation(coarseLocation);
          setNeedsManualConfirm(true);
          return;
        }

        setNeedsManualConfirm(anomaly.trustScore < 55);
        setLocation({
          lat: sample.lat,
          lon: sample.lon,
          accuracy: sample.accuracy,
          timestamp: sample.timestamp
        });
      },
      () => {
        if (coarseLocation) {
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
  }, [coarseLocation]);

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
    setLocation(manualLocation);
    setNeedsManualConfirm(false);
    setTrustScore(80);
    setFlags((current) => [...current.filter((flag) => flag !== "manual_override"), "manual_override"]);
  }, []);

  return useMemo(
    () => ({
      location,
      trustScore,
      flags,
      needsManualConfirm,
      setManualLocation
    }),
    [flags, location, needsManualConfirm, setManualLocation, trustScore]
  );
};
