import { describe, expect, it } from "vitest";
import { TrackManager } from "../server/core/trackManager.js";
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
});
