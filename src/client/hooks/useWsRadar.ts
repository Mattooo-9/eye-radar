import { useEffect, useMemo, useRef, useState } from "react";
import type { TrustedLocation } from "../location/useTrustedLocation";

export type TrackPacket = [
  id: string,
  type: string,
  lat: number,
  lon: number,
  heading: number,
  speed: number,
  timestamp: number,
  confidence?: number,
  uncertaintyRadius?: number,
  threatLevel?: string
];

interface ConfigResponse {
  wsUrl: string;
  mapStyleUrl: string;
}

export const useWsRadar = (
  userId: string,
  location: TrustedLocation | null,
  trustScore: number,
  flags: string[]
) => {
  const [packets, setPackets] = useState<TrackPacket[]>([]);
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "open" | "closed">(
    "idle"
  );
  const [mapStyleUrl, setMapStyleUrl] = useState("https://demotiles.maplibre.org/style.json");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async (): Promise<void> => {
      setConnectionState("connecting");
      const response = await fetch("/api/config");
      const config = (await response.json()) as ConfigResponse;

      if (cancelled) {
        return;
      }

      setMapStyleUrl(config.mapStyleUrl);
      const socket = new WebSocket(config.wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnectionState("open");
      };

      socket.onclose = () => {
        setConnectionState("closed");
      };

      socket.onmessage = (event) => {
        const [kind, _stamp, payload] = JSON.parse(event.data) as [number, number, TrackPacket[]];
        if (kind === 0 && Array.isArray(payload)) {
          setPackets(payload);
        }
      };
    };

    void bootstrap();

    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!location || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    socketRef.current.send(
      JSON.stringify([
        0,
        userId,
        location.lat,
        location.lon,
        location.accuracy,
        location.timestamp,
        trustScore,
        flags.join("|")
      ])
    );
  }, [flags, location, trustScore, userId]);

  return useMemo(
    () => ({
      packets,
      connectionState,
      mapStyleUrl
    }),
    [connectionState, mapStyleUrl, packets]
  );
};
