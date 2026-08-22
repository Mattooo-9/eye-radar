import { createHash } from "node:crypto";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { applyDynamicJitter } from "../core/jitter.js";
import type { ClientSession, CompactTrackPacket, UserLocation } from "../domain/types.js";

type IncomingClientMessage = [
  kind: number,
  userId: string,
  lat: number,
  lon: number,
  accuracy: number,
  timestamp: number,
  trustScore?: number,
  flags?: string
];

export class RadarHub {
  private readonly sessions = new Map<WebSocket, ClientSession>();

  constructor(private readonly wss: WebSocketServer) {
    this.wss.on("connection", (socket) => {
      this.sessions.set(socket, {
        userId: createHash("sha1").update(`${Date.now()}:${Math.random()}`).digest("hex"),
        trustScore: 100,
        anomalyFlags: []
      });

      socket.on("message", (data) => this.onMessage(socket, data));
      socket.on("close", () => {
        this.sessions.delete(socket);
      });
    });
  }

  broadcastTracks(packets: CompactTrackPacket[]): void {
    for (const [socket, session] of this.sessions.entries()) {
      if (socket.readyState !== socket.OPEN) {
        continue;
      }

      const payload = JSON.stringify([0, Date.now(), applyDynamicJitter(packets, session.location)]);
      socket.send(payload, { binary: false });
    }
  }

  private onMessage(socket: WebSocket, rawData: RawData): void {
    try {
      const parsed = JSON.parse(rawData.toString()) as IncomingClientMessage;
      const [kind, userId, lat, lon, accuracy, timestamp, trustScore, flags] = parsed;
      const session = this.sessions.get(socket);

      if (!session || (kind !== 0 && kind !== 1)) {
        return;
      }

      const location: UserLocation = { lat, lon, accuracy, timestamp };
      session.userId = userId || session.userId;
      session.location = location;
      session.trustScore = typeof trustScore === "number" ? trustScore : session.trustScore;
      session.anomalyFlags = flags ? flags.split("|").filter(Boolean) : [];

      socket.send(JSON.stringify([1, session.trustScore, session.anomalyFlags.join("|")]));
    } catch {
      socket.send(JSON.stringify([9, "bad_message"]));
    }
  }
}
