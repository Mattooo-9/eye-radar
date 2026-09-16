import { describe, expect, it } from "vitest";
import { TrackManager } from "../server/core/trackManager.js";
import { RadarHub } from "../server/ws/hub.js";
import { decodeBinaryTracks } from "../common/binaryCodec.js";
import type { Observation } from "../server/domain/types.js";

describe("WebSocket Delta & Sequence Synchronization", () => {
  it("increments sequence numbers monotonically on successive delta packets", () => {
    const manager = new TrackManager();
    const now = Date.now();

    const obs1: Observation = {
      id: "trk-seq-1",
      type: "uav",
      lat: 48.0,
      lon: 35.0,
      speed: 50,
      heading: 90,
      timestamp: now,
      source: "sdr",
      confidence: 0.95
    };

    manager.ingest(obs1, now);

    const delta1 = manager.getDeltaPacket();
    expect(delta1.seq).toBe(1);
    expect(delta1.tracks.length).toBe(1);
    expect(delta1.removedIds.length).toBe(0);

    const delta2 = manager.getDeltaPacket();
    expect(delta2.seq).toBe(2);
    expect(delta2.tracks.length).toBe(1);

    const delta3 = manager.getDeltaPacket();
    expect(delta3.seq).toBe(3);
  });

  it("records and delivers removedIds when a target is pruned or eliminated", () => {
    const manager = new TrackManager();
    const now = Date.now();

    manager.ingest(
      {
        id: "trk-drop-target",
        type: "munition",
        lat: 49.5,
        lon: 32.5,
        speed: 240,
        heading: 270,
        timestamp: now,
        source: "sdr",
        confidence: 0.92
      },
      now
    );

    const deltaInitial = manager.getDeltaPacket();
    expect(deltaInitial.tracks.some((t) => t[0] === "trk-drop-target")).toBe(true);

    // Remove track (e.g. interception or hit)
    const removed = manager.removeTrack("trk-drop-target");
    expect(removed).toBe(true);

    // Next delta MUST contain "trk-drop-target" in removedIds
    const deltaAfterRemove = manager.getDeltaPacket();
    expect(deltaAfterRemove.removedIds).toContain("trk-drop-target");
    expect(deltaAfterRemove.tracks.some((t) => t[0] === "trk-drop-target")).toBe(false);

    // Subsequent delta must have flushed removedIds
    const deltaSubsequent = manager.getDeltaPacket();
    expect(deltaSubsequent.removedIds.length).toBe(0);
  });

  it("formats compact packets with exact 13-element schema", () => {
    const manager = new TrackManager();
    const now = Date.now();

    manager.ingest(
      {
        id: "shahed-precision-01",
        type: "uav",
        lat: 50.1234567,
        lon: 30.7654321,
        speed: 51.25,
        heading: 185.5,
        altitude: 280,
        timestamp: now,
        source: "sdr",
        confidence: 0.9,
        meta: {
          model: "Shahed-136",
          callsign: "SH-99"
        }
      },
      now
    );

    const packets = manager.toPackets();
    expect(packets.length).toBe(1);
    const p = packets[0];

    // Check schema [id, type, lat, lon, heading, speed, timestamp, confidence, uncertainty, threat, alt, model, callsign]
    expect(p.length).toBe(13);
    expect(p[0]).toBe("shahed-precision-01");
    expect(p[1]).toBe("uav");
    expect(typeof p[2]).toBe("number"); // lat
    expect(typeof p[3]).toBe("number"); // lon
    expect(typeof p[4]).toBe("number"); // heading
    expect(typeof p[5]).toBe("number"); // speed
    expect(p[6]).toBe(now);              // timestamp
    expect(p[7]).toBeGreaterThan(0.8);  // confidence
    expect(p[11]).toContain("Shahed");  // model
    expect(p[12]).toBe("SH-99");        // callsign
  });

  it("handles backpressure by consolidating deltas by trackId without losing updates", () => {
    // Mock WebSocket with configurable bufferedAmount
    const sentFrames: (string | Uint8Array)[] = [];
    let fakeBufferedAmount = 100 * 1024; // > 64 KB, congested!

    const mockSocket = {
      readyState: 1, // OPEN
      OPEN: 1,
      get bufferedAmount() {
        return fakeBufferedAmount;
      },
      send: (data: string | Uint8Array) => {
        sentFrames.push(data);
      },
      on: () => {},
      terminate: () => {}
    };

    const mockWss = {
      on: (event: string, cb: (socket: any) => void) => {
        if (event === "connection") {
          cb(mockSocket);
        }
      }
    };

    const hub = new RadarHub(mockWss as any);

    // Initial snapshot was sent on connection, clear test log
    sentFrames.length = 0;

    const t1_v1: any = ["target-1", "uav", 48.0, 35.0, 90, 50, Date.now(), 0.9, 30, "medium", 500, "S-1", "C-1"];
    const t2_v1: any = ["target-2", "munition", 49.0, 32.0, 180, 200, Date.now(), 0.95, 20, "high", 300, "M-1", "C-2"];

    // Broadcast cycle 1 while congested (> 64 KB)
    hub.broadcastTracks([t1_v1, t2_v1], 10, undefined, []);
    // Under backpressure, socket.send should NOT be called for delta
    expect(sentFrames.length).toBe(0);

    // Broadcast cycle 2 while still congested: target-1 updates with new position, target-3 added
    const t1_v2: any = ["target-1", "uav", 48.05, 35.05, 95, 52, Date.now(), 0.92, 25, "high", 550, "S-1", "C-1"];
    const t3_v1: any = ["target-3", "fpv", 47.5, 36.5, 45, 30, Date.now(), 0.88, 15, "low", 50, "FPV-1", "C-3"];
    hub.broadcastTracks([t1_v2, t3_v1], 11, undefined, ["target-2"]); // target-2 was eliminated
    expect(sentFrames.length).toBe(0);

    // Now buffer drains: client caught up!
    fakeBufferedAmount = 10 * 1024; // <= 64 KB

    // Cycle 3: broadcast frame
    const t4_v1: any = ["target-4", "aircraft", 50.0, 30.0, 270, 150, Date.now(), 0.9, 40, "medium", 2000, "A-1", "C-4"];
    hub.broadcastTracks([t4_v1], 12, undefined, []);

    // Buffer was cleared, so hub MUST have flushed consolidated delta
    expect(sentFrames.length).toBe(1);

    const decoded = decodeBinaryTracks(sentFrames[0] as Uint8Array);

    // Consolidated frame should contain latest state of target-1 (v2), target-3, target-4, and removed target-2
    expect(decoded.tracks.length).toBe(3);
    const decodedT1 = decoded.tracks.find((t: any) => t[0] === "target-1");
    expect(decodedT1).toBeDefined();
    expect(decodedT1![2]).toBeCloseTo(48.05, 4); // latest state, NOT dropped!
    expect(decodedT1![9]).toBe("high");

    const decodedT3 = decoded.tracks.find((t: any) => t[0] === "target-3");
    expect(decodedT3).toBeDefined();

    const decodedT4 = decoded.tracks.find((t: any) => t[0] === "target-4");
    expect(decodedT4).toBeDefined();

    expect(decoded.removedIds).toContain("target-2");
  });
});
