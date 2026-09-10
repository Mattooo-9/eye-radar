import { useEffect, useMemo, useRef, useState } from "react";
import type { TrustedLocation } from "../location/useTrustedLocation";

export interface ImpactEvent {
  id: string;
  type: "impact" | "intercept";
  lat: number;
  lon: number;
  timestamp: number;
  targetModel: string;
  targetType: string;
  region: string;
  details?: string;
}

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
  threatLevel?: string,
  altitude?: number,
  model?: string,
  callsign?: string
];

interface ConfigResponse {
  wsUrl: string;
  mapStyleUrl: string;
}

interface TargetApiResponse {
  count: number;
  tracks: Array<{
    id: string;
    type: string;
    lat: number;
    lon: number;
    heading: number;
    speed: number;
    timestamp: number;
    confidence: number;
    uncertaintyRadius?: number;
    threatLevel?: string;
    altitude?: number;
    model?: string;
    callsign?: string;
  }>;
}

export const useWsRadar = (
  userId: string,
  location: TrustedLocation | null,
  trustScore: number,
  flags: string[]
) => {
  const [packets, setPackets] = useState<TrackPacket[]>([]);
  const [impacts, setImpacts] = useState<ImpactEvent[]>([]);
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "open" | "closed">(
    "idle"
  );
  const [mapStyleUrl, setMapStyleUrl] = useState(
    "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json"
  );
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let unmounted = false;

    const determineWsUrl = (serverConfigUrl?: string): string => {
      const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
      const host = typeof window !== "undefined" ? window.location.host : "localhost:3000";
      let localWs = `${isHttps ? "wss:" : "ws:"}//${host}/ws`;

      // When running on Vercel CDN or custom domain, route WebSocket directly to high-availability Render core
      if (typeof window !== "undefined" && (window.location.host.includes("vercel.app") || window.location.host.includes("eye-radar"))) {
        localWs = "wss://eye-radar.onrender.com/ws";
      }

      if (serverConfigUrl && serverConfigUrl.startsWith("ws")) {
        // Enforce wss if on https page to avoid mixed content error
        if (isHttps && serverConfigUrl.startsWith("ws://")) {
          return serverConfigUrl.replace("ws://", "wss://");
        }
        return serverConfigUrl;
      }

      return localWs;
    };

    const pollFallback = async () => {
      if (unmounted) return;
      try {
        const [targetsRes, impactsRes] = await Promise.all([
          fetch("/api/targets", { signal: AbortSignal.timeout(3000) }),
          fetch("/api/impacts", { signal: AbortSignal.timeout(3000) })
        ]);

        if (targetsRes.ok) {
          const data = (await targetsRes.json()) as TargetApiResponse;
          if (Array.isArray(data.tracks)) {
            const converted: TrackPacket[] = data.tracks.map((t) => [
              t.id,
              t.type,
              t.lat,
              t.lon,
              t.heading,
              t.speed,
              t.timestamp,
              t.confidence,
              t.uncertaintyRadius,
              t.threatLevel,
              t.altitude,
              t.model,
              t.callsign
            ]);
            setPackets(converted);
          }
        }

        if (impactsRes.ok) {
          const impactData = (await impactsRes.json()) as { events?: ImpactEvent[] };
          if (Array.isArray(impactData.events)) {
            setImpacts(impactData.events);
          }
        }
      } catch {}
    };

    const connect = async () => {
      if (unmounted) return;
      setConnectionState("connecting");

      let wsUrl = determineWsUrl();
      try {
        const response = await fetch("/api/config", { signal: AbortSignal.timeout(4000) });
        if (response.ok) {
          const config = (await response.json()) as ConfigResponse;
          if (config.mapStyleUrl) setMapStyleUrl(config.mapStyleUrl);
          wsUrl = determineWsUrl(config.wsUrl);
        }
      } catch {}

      if (unmounted) return;

      try {
        const socket = new WebSocket(wsUrl);
        socketRef.current = socket;

        socket.onopen = () => {
          if (unmounted) return;
          setConnectionState("open");
        };

        socket.onclose = () => {
          if (unmounted) return;
          setConnectionState("closed");
          // Reconnect with backoff
          reconnectTimerRef.current = window.setTimeout(connect, 3000);
        };

        socket.onerror = () => {
          socket.close();
        };

        socket.onmessage = (event) => {
          if (unmounted) return;
          try {
            const parsed = JSON.parse(event.data);
            const kind = parsed[0];
            const payload = parsed[2];

            if (kind === 0 && Array.isArray(payload)) {
              setPackets(payload);
            } else if (kind === 2 && Array.isArray(payload)) {
              setImpacts(payload);
            }
          } catch {}
        };
      } catch {
        if (!unmounted) {
          setConnectionState("closed");
          reconnectTimerRef.current = window.setTimeout(connect, 4000);
        }
      }
    };

    void pollFallback();
    void connect();

    // Secondary resilient polling loop (keeps data flowing even if WebSockets are throttled by mobile OS)
    pollTimerRef.current = window.setInterval(() => {
      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        void pollFallback();
      }
    }, 4000);

    return () => {
      unmounted = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!location || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
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
    } catch {}
  }, [flags, location, trustScore, userId]);

  return useMemo(
    () => ({
      packets,
      impacts,
      connectionState,
      mapStyleUrl
    }),
    [connectionState, impacts, mapStyleUrl, packets]
  );
};
