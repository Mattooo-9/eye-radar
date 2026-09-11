import { createHash } from "node:crypto";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { applyDynamicJitter } from "../core/jitter.js";
import type { ClientSession, CompactTrackPacket, ImpactEvent, UserLocation } from "../domain/types.js";
import { encodeBinarySnapshot, encodeBinaryDelta, encodeBinaryImpacts } from "../../common/binaryCodec.js";

type ExtendedSession = ClientSession & {
  lastSeenSeq?: number;
  lastHeartbeat?: number;
  binaryMode?: boolean;
  pendingCongestedTracks?: Map<string, CompactTrackPacket>;
  pendingCongestedRemoved?: Set<string>;
  lastKnownState?: Map<string, CompactTrackPacket>;
};

type IncomingClientMessage =
  | [kind: 0 | 1, userId: string, lat: number, lon: number, accuracy: number, timestamp: number, trustScore?: number, flags?: string]
  | [kind: 8, lastSeq: number] // resume / reconcile request
  | [kind: 9, clientTimestamp: number]; // ping

export class RadarHub {
  private readonly sessions = new Map<WebSocket, ExtendedSession>();
  private currentSeq = 0;
  private heartbeatTimer?: NodeJS.Timeout;

  private initialSnapshotProvider?: () => CompactTrackPacket[];
  private binarySnapshotProvider?: () => Uint8Array;

  constructor(private readonly wss: WebSocketServer) {
    this.wss.on("connection", (socket) => {
      const session: ExtendedSession = {
        userId: createHash("sha1").update(`${Date.now()}:${Math.random()}`).digest("hex"),
        trustScore: 100,
        anomalyFlags: [],
        lastHeartbeat: Date.now(),
        binaryMode: true
      };
      this.sessions.set(socket, session);

      // Send initial track snapshot immediately
      if (this.binarySnapshotProvider) {
        try {
          const bin = this.binarySnapshotProvider();
          if (bin && bin.length > 0) {
            socket.send(bin, { binary: true });
          }
        } catch {}
      } else if (this.initialSnapshotProvider) {
        try {
          const packets = this.initialSnapshotProvider();
          if (packets && packets.length > 0) {
            socket.send(JSON.stringify([0, Date.now(), packets, this.currentSeq]));
          }
        } catch {}
      }

      socket.on("message", (data) => this.onMessage(socket, data));
      socket.on("close", () => {
        this.sessions.delete(socket);
      });
    });

    // Start 5-second periodic heartbeat to detect dead connections and measure latency
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 5_000);
    this.heartbeatTimer.unref();
  }

  setInitialSnapshotProvider(provider: () => CompactTrackPacket[]): void {
    this.initialSnapshotProvider = provider;
  }

  setBinarySnapshotProvider(provider: () => Uint8Array): void {
    this.binarySnapshotProvider = provider;
  }

  getClientCount(): number {
    return this.sessions.size;
  }

  private sendHeartbeat(): void {
    const now = Date.now();
    const payload = JSON.stringify([9, now, this.currentSeq]);
    for (const [socket, session] of this.sessions.entries()) {
      if (socket.readyState === socket.OPEN) {
        // Drop client if no response to heartbeat in 30s
        if (session.lastHeartbeat && now - session.lastHeartbeat > 30_000) {
          socket.terminate();
          this.sessions.delete(socket);
          continue;
        }
        socket.send(payload, { binary: false });
      }
    }
  }

  broadcastTracks(
    packets: CompactTrackPacket[],
    seq?: number,
    binaryBuffer?: Uint8Array,
    removedIds: string[] = []
  ): void {
    const now = Date.now();
    this.currentSeq = seq ?? (this.currentSeq + 1);

    for (const [socket, session] of this.sessions.entries()) {
      if (socket.readyState !== socket.OPEN) {
        continue;
      }

      // Backpressure protection: when client buffer is congested (> 64 KB),
      // accumulate deltas by trackId and keep the latest state so no critical updates are lost.
      if (socket.bufferedAmount > 64 * 1024) {
        session.pendingCongestedTracks ??= new Map();
        session.pendingCongestedRemoved ??= new Set();

        for (const t of packets) {
          session.pendingCongestedTracks.set(t[0], t);
          session.pendingCongestedRemoved.delete(t[0]);
        }
        for (const rid of removedIds) {
          session.pendingCongestedTracks.delete(rid);
          session.pendingCongestedRemoved.add(rid);
        }
        continue;
      }

      // If client was previously congested, consolidate accumulated backlog with current deltas
      if (
        (session.pendingCongestedTracks && session.pendingCongestedTracks.size > 0) ||
        (session.pendingCongestedRemoved && session.pendingCongestedRemoved.size > 0)
      ) {
        for (const t of packets) {
          session.pendingCongestedTracks!.set(t[0], t);
          session.pendingCongestedRemoved!.delete(t[0]);
        }
        for (const rid of removedIds) {
          session.pendingCongestedTracks!.delete(rid);
          session.pendingCongestedRemoved!.add(rid);
        }

        const consolidatedTracks = Array.from(session.pendingCongestedTracks!.values());
        const consolidatedRemoved = Array.from(session.pendingCongestedRemoved!);

        session.pendingCongestedTracks?.clear();
        session.pendingCongestedRemoved?.clear();

        if (session.binaryMode) {
          const consolidatedBuffer = encodeBinaryDelta(
            consolidatedTracks,
            consolidatedRemoved,
            this.currentSeq,
            now,
            session.lastKnownState
          );
          socket.send(consolidatedBuffer, { binary: true });
        } else {
          const payload = JSON.stringify([
            0,
            now,
            applyDynamicJitter(consolidatedTracks, session.location),
            this.currentSeq
          ]);
          socket.send(payload, { binary: false });
        }

        session.lastKnownState ??= new Map();
        for (const t of consolidatedTracks) {
          session.lastKnownState.set(t[0], t);
        }
        for (const rid of consolidatedRemoved) {
          session.lastKnownState.delete(rid);
        }
        continue;
      }

      // Normal un-congested transmission
      if (session.binaryMode && binaryBuffer) {
        socket.send(binaryBuffer, { binary: true });
      } else {
        const payload = JSON.stringify([
          0,
          now,
          applyDynamicJitter(packets, session.location),
          this.currentSeq
        ]);
        socket.send(payload, { binary: false });
      }

      if (session.lastKnownState) {
        for (const t of packets) {
          session.lastKnownState.set(t[0], t);
        }
        for (const rid of removedIds) {
          session.lastKnownState.delete(rid);
        }
      }
    }
  }

  broadcastImpacts(impacts: ImpactEvent[]): void {
    const now = Date.now();
    const bin = encodeBinaryImpacts(impacts, now);
    const jsonPayload = JSON.stringify([2, now, impacts]);

    for (const [socket, session] of this.sessions.entries()) {
      if (socket.readyState === socket.OPEN) {
        if (socket.bufferedAmount > 64 * 1024) {
          continue;
        }
        if (session.binaryMode) {
          socket.send(bin, { binary: true });
        } else {
          socket.send(jsonPayload, { binary: false });
        }
      }
    }
  }

  private onMessage(socket: WebSocket, rawData: RawData): void {
    try {
      const parsed = JSON.parse(rawData.toString()) as IncomingClientMessage;
      const kind = parsed[0];
      const session = this.sessions.get(socket);
      if (!session) return;

      session.lastHeartbeat = Date.now();

      // Kind 9: Client Pong
      if (kind === 9) {
        const clientSent = parsed[1];
        const rtt = Date.now() - clientSent;
        socket.send(JSON.stringify([9, Date.now(), rtt]));
        return;
      }

      // Kind 8: Client Reconnect Resume / Resync request
      if (kind === 8) {
        const clientLastSeq = parsed[1];
        session.lastSeenSeq = clientLastSeq;
        session.pendingCongestedTracks?.clear();
        session.pendingCongestedRemoved?.clear();
        session.lastKnownState?.clear();

        if (this.binarySnapshotProvider && session.binaryMode) {
          try {
            const bin = this.binarySnapshotProvider();
            socket.send(bin, { binary: true });
          } catch {}
        } else if (this.initialSnapshotProvider) {
          try {
            const packets = this.initialSnapshotProvider();
            socket.send(JSON.stringify([0, Date.now(), packets, this.currentSeq]));
          } catch {}
        }
        return;
      }

      // Kind 0/1: User location update
      if (kind === 0 || kind === 1) {
        const [, userId, lat, lon, accuracy, timestamp, trustScore, flags] = parsed;
        const location: UserLocation = { lat, lon, accuracy, timestamp };
        session.userId = userId || session.userId;
        session.location = location;
        session.trustScore = typeof trustScore === "number" ? trustScore : session.trustScore;
        session.anomalyFlags = flags ? flags.split("|").filter(Boolean) : [];

        socket.send(JSON.stringify([1, session.trustScore, session.anomalyFlags.join("|")]));
      }
    } catch {
      socket.send(JSON.stringify([9, "bad_message"]));
    }
  }
}
