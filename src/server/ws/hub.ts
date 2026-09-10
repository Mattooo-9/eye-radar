import { createHash } from "node:crypto";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { applyDynamicJitter } from "../core/jitter.js";
import type { ClientSession, CompactTrackPacket, ImpactEvent, UserLocation } from "../domain/types.js";

type IncomingClientMessage =
  | [kind: 0 | 1, userId: string, lat: number, lon: number, accuracy: number, timestamp: number, trustScore?: number, flags?: string]
  | [kind: 8, lastSeq: number] // resume / reconcile request
  | [kind: 9, clientTimestamp: number]; // ping

export class RadarHub {
  private readonly sessions = new Map<WebSocket, ClientSession & { lastSeenSeq?: number; lastHeartbeat?: number }>();
  private currentSeq = 0;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly wss: WebSocketServer) {
    this.wss.on("connection", (socket) => {
      this.sessions.set(socket, {
        userId: createHash("sha1").update(`${Date.now()}:${Math.random()}`).digest("hex"),
        trustScore: 100,
        anomalyFlags: [],
        lastHeartbeat: Date.now()
      });

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

  broadcastTracks(packets: CompactTrackPacket[], seq?: number): void {
    const now = Date.now();
    this.currentSeq = seq ?? (this.currentSeq + 1);

    for (const [socket, session] of this.sessions.entries()) {
      if (socket.readyState !== socket.OPEN) {
        continue;
      }

      const payload = JSON.stringify([
        0,
        now,
        applyDynamicJitter(packets, session.location),
        this.currentSeq
      ]);
      socket.send(payload, { binary: false });
    }
  }

  broadcastImpacts(impacts: ImpactEvent[]): void {
    const payload = JSON.stringify([2, Date.now(), impacts]);
    for (const socket of this.sessions.keys()) {
      if (socket.readyState === socket.OPEN) {
        socket.send(payload, { binary: false });
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

      // Kind 8: Client Reconnect Resume request
      if (kind === 8) {
        const clientLastSeq = parsed[1];
        session.lastSeenSeq = clientLastSeq;
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
