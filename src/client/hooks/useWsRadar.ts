import { useEffect, useMemo, useRef, useState } from "react";
import type { TrustedLocation } from "../location/useTrustedLocation";
import {
  decodeBinaryTracks,
  decodeBinaryImpacts,
  BINARY_MAGIC,
  PROTOCOL_VERSION
} from "../../common/binaryCodec.js";
import type { CompactTrackPacket } from "../../server/domain/types.js";

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
  const workerRef = useRef<Worker | null>(null);
  const fallbackTracksMap = useRef<Map<string, CompactTrackPacket>>(new Map());

  useEffect(() => {
    let unmounted = false;

    // Initialize background Web Worker for binary decoding
    try {
      if (typeof window !== "undefined" && typeof Worker !== "undefined") {
        const worker = new Worker(new URL("../workers/radarWorker.ts", import.meta.url), {
          type: "module"
        });

        worker.onmessage = (e: MessageEvent) => {
          if (unmounted) return;
          const { type, tracks, events, expectedSeq } = e.data;
          if (type === "TRACKS_UPDATED" && Array.isArray(tracks)) {
            setPackets(tracks as TrackPacket[]);
          } else if (type === "IMPACTS_UPDATED" && Array.isArray(events)) {
            setImpacts(events as ImpactEvent[]);
          } else if (type === "RESYNC_NEEDED") {
            // Request resync snapshot from server
            if (socketRef.current?.readyState === WebSocket.OPEN) {
              socketRef.current.send(JSON.stringify([8, expectedSeq || 0]));
            }
          }
        };

        workerRef.current = worker;
      }
    } catch {
      workerRef.current = null;
    }

    const determineWsUrl = (serverConfigUrl?: string): string => {
      const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
      const host = typeof window !== "undefined" ? window.location.host : "localhost:3000";
      let localWs = `${isHttps ? "wss:" : "ws:"}//${host}/ws`;

      if (typeof window !== "undefined" && (window.location.host.includes("vercel.app") || window.location.host.includes("eye-radar"))) {
        localWs = "wss://eye-radar.onrender.com/ws";
      }

      if (serverConfigUrl && serverConfigUrl.startsWith("ws")) {
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
        socket.binaryType = "arraybuffer";
        socketRef.current = socket;

        socket.onopen = () => {
          if (unmounted) return;
          setConnectionState("open");
        };

        socket.onclose = () => {
          if (unmounted) return;
          setConnectionState("closed");
          reconnectTimerRef.current = window.setTimeout(connect, 3000);
        };

        socket.onerror = () => {
          socket.close();
        };

        socket.onmessage = (event: MessageEvent) => {
          if (unmounted) return;

          // 1. Binary payload (High performance, low bandwidth)
          if (event.data instanceof ArrayBuffer) {
            const buffer = event.data;
            if (buffer.byteLength >= 4) {
              const view = new DataView(buffer);
              const magic = view.getUint16(0, true);
              if (magic === BINARY_MAGIC) {
                const version = view.getUint8(2);
                if (version !== PROTOCOL_VERSION) {
                  console.warn(`[ws] Incompatible binary protocol version: ${version} (expected ${PROTOCOL_VERSION}), requesting resync fallback`);
                  if (socketRef.current?.readyState === WebSocket.OPEN) {
                    socketRef.current.send(JSON.stringify([8, 0]));
                  }
                  return;
                }
                const kind = view.getUint8(3);

                if (workerRef.current) {
                  // Offload decoding to Web Worker using transferable ArrayBuffer
                  if (kind === 0x00 || kind === 0x01) {
                    workerRef.current.postMessage({ type: "PROCESS_BINARY", buffer }, [buffer]);
                  } else if (kind === 0x02) {
                    workerRef.current.postMessage({ type: "PROCESS_IMPACTS", buffer }, [buffer]);
                  }
                  return;
                }

                // Main-thread fallback if Web Worker is disabled
                if (kind === 0x00 || kind === 0x01) {
                  const decoded = decodeBinaryTracks(buffer, fallbackTracksMap.current);
                  if (decoded.kind === 0x00) {
                    fallbackTracksMap.current.clear();
                  }
                  for (const t of decoded.tracks) {
                    fallbackTracksMap.current.set(t[0], t);
                  }
                  for (const rid of decoded.removedIds) {
                    fallbackTracksMap.current.delete(rid);
                  }
                  setPackets(Array.from(fallbackTracksMap.current.values()));
                } else if (kind === 0x02) {
                  const decoded = decodeBinaryImpacts(buffer);
                  setImpacts(decoded.events);
                }
                return;
              }
            }
          }

          // 2. Legacy JSON fallback
          if (typeof event.data === "string") {
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
          }
        };
      } catch {
        if (!unmounted) {
          setConnectionState("closed");
          reconnectTimerRef.current = window.setTimeout(connect, 4000);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          // App returned from background: request fresh snapshot resync immediately
          socketRef.current.send(JSON.stringify([8, 0]));
        } else if (!socketRef.current || socketRef.current.readyState === WebSocket.CLOSED) {
          void connect();
        }
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    void pollFallback();
    void connect();

    // Secondary resilient polling loop
    pollTimerRef.current = window.setInterval(() => {
      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        void pollFallback();
      }
    }, 4000);

    return () => {
      unmounted = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
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
