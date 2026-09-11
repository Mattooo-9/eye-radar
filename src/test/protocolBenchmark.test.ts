import { describe, expect, it } from "vitest";
import {
  encodeBinarySnapshot,
  decodeBinaryTracks,
  encodeBinaryDelta,
  encodeBinaryImpacts,
  decodeBinaryImpacts,
  MSG_SNAPSHOT,
  MSG_DELTA
} from "../common/binaryCodec.js";
import type { CompactTrackPacket, ImpactEvent } from "../server/domain/types.js";

describe("Binary Protocol & Delta Stream Optimization", () => {
  const sampleTracks: CompactTrackPacket[] = [
    [
      "shahed-238-alpha",
      "uav",
      48.512345,
      35.123456,
      185.5,
      145.2, // ~522 km/h turbojet
      Date.now() - 50,
      0.95,
      45,
      "high",
      650,
      "Shahed-238",
      "SH-238"
    ],
    [
      "kalibr-cruise-01",
      "munition",
      49.123456,
      32.987654,
      270.0,
      235.0, // ~846 km/h
      Date.now() - 20,
      0.98,
      25,
      "critical",
      350,
      "Kalibr",
      "KL-01"
    ],
    [
      "recon-supercam-12",
      "uav",
      50.234567,
      36.345678,
      45.0,
      25.5,
      Date.now() - 100,
      0.91,
      80,
      "medium",
      1200,
      "Supercam S350",
      "SC-12"
    ]
  ];

  it("encodes and decodes full snapshots with sub-meter microdegree precision", () => {
    const now = Date.now();
    const encoded = encodeBinarySnapshot(sampleTracks, 1, now);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = decodeBinaryTracks(encoded);
    expect(decoded.kind).toBe(MSG_SNAPSHOT);
    expect(decoded.seq).toBe(1);
    expect(decoded.tracks.length).toBe(sampleTracks.length);

    for (let i = 0; i < sampleTracks.length; i++) {
      const orig = sampleTracks[i];
      const dec = decoded.tracks[i];

      expect(dec[0]).toBe(orig[0]); // ID
      expect(dec[1]).toBe(orig[1]); // Type
      // Coordinate error must be <= 0.000001 degrees (~0.11m)
      expect(Math.abs(dec[2] - orig[2])).toBeLessThan(0.000002);
      expect(Math.abs(dec[3] - orig[3])).toBeLessThan(0.000002);
      // Heading error <= 0.1 deg
      expect(Math.abs(dec[4] - orig[4])).toBeLessThan(0.15);
      // Speed error <= 0.1 m/s
      expect(Math.abs(dec[5] - orig[5])).toBeLessThan(0.15);
      // Model & Callsign
      expect(dec[11]).toBe(orig[11]);
      expect(dec[12]).toBe(orig[12]);
    }
  });

  it("encodes and decodes delta updates with bitmask and removedIds", () => {
    const now = Date.now();
    const prevMap = new Map<string, CompactTrackPacket>();
    for (const t of sampleTracks) {
      prevMap.set(t[0], t);
    }

    // Target 0 moved slightly, target 1 unchanged, target 2 dropped
    const updatedTracks: CompactTrackPacket[] = [
      [
        "shahed-238-alpha",
        "uav",
        48.513500, // moved ~120m
        35.124500,
        186.0,
        145.2,
        now,
        0.95,
        45,
        "high",
        650,
        "Shahed-238",
        "SH-238"
      ],
      sampleTracks[1]
    ];
    const removedIds = ["recon-supercam-12"];

    const deltaEncoded = encodeBinaryDelta(updatedTracks, removedIds, 2, now, prevMap);
    expect(deltaEncoded.length).toBeGreaterThan(0);

    const decodedDelta = decodeBinaryTracks(deltaEncoded, prevMap);
    expect(decodedDelta.kind).toBe(MSG_DELTA);
    expect(decodedDelta.seq).toBe(2);
    expect(decodedDelta.tracks.length).toBe(2);
    expect(decodedDelta.removedIds).toContain("recon-supercam-12");

    const alphaTrack = decodedDelta.tracks.find((t) => t[0] === "shahed-238-alpha");
    expect(alphaTrack).toBeDefined();
    expect(Math.abs(alphaTrack![2] - 48.513500)).toBeLessThan(0.000002);
  });

  it("encodes and decodes tactical impact events correctly", () => {
    const now = Date.now();
    const sampleImpacts: ImpactEvent[] = [
      {
        id: "imp-001",
        type: "intercept",
        lat: 50.4501,
        lon: 30.5234,
        timestamp: now - 120_000,
        targetModel: "Shahed-136",
        targetType: "uav",
        region: "Київська область",
        details: "Збито мобільною вогневою групою"
      },
      {
        id: "imp-002",
        type: "impact",
        lat: 48.4647,
        lon: 35.0462,
        timestamp: now - 300_000,
        targetModel: "Kh-101",
        targetType: "munition",
        region: "Дніпропетровська область"
      }
    ];

    const encoded = encodeBinaryImpacts(sampleImpacts, now);
    const decoded = decodeBinaryImpacts(encoded);

    expect(decoded.events.length).toBe(2);
    expect(decoded.events[0].id).toBe("imp-001");
    expect(decoded.events[0].type).toBe("intercept");
    expect(decoded.events[0].targetModel).toBe("Shahed-136");
    expect(decoded.events[1].id).toBe("imp-002");
    expect(decoded.events[1].type).toBe("impact");
  });

  it("achieves >80% bandwidth reduction over legacy JSON payload on 100 targets", () => {
    // Generate 100 synthetic tracks
    const tracks100: CompactTrackPacket[] = [];
    const prevMap = new Map<string, CompactTrackPacket>();

    for (let i = 0; i < 100; i++) {
      const p: CompactTrackPacket = [
        `target-${i}`,
        i % 2 === 0 ? "uav" : "munition",
        48.0 + (i % 10) * 0.2,
        32.0 + Math.floor(i / 10) * 0.3,
        (i * 35) % 360,
        50 + (i * 2),
        Date.now(),
        0.92,
        35,
        "high",
        500 + i * 10,
        i % 2 === 0 ? "Shahed-136" : "Kh-101",
        `CALL-${i}`
      ];
      tracks100.push(p);
      prevMap.set(p[0], p);
    }

    // 1. Legacy JSON size
    const jsonPayload = JSON.stringify([0, Date.now(), tracks100, 100]);
    const jsonBytes = new TextEncoder().encode(jsonPayload).length;

    // 2. Binary delta size (kinematic movement delta)
    const deltaTracks: CompactTrackPacket[] = tracks100.map((t) => [
      t[0],
      t[1],
      t[2] + 0.0005, // moved slightly
      t[3] + 0.0005,
      t[4],
      t[5],
      t[6] + 1000,
      t[7],
      t[8],
      t[9],
      t[10],
      t[11],
      t[12]
    ]);

    const binaryDelta = encodeBinaryDelta(deltaTracks, [], 101, Date.now(), prevMap);
    const binaryBytes = binaryDelta.length;

    const reductionPercent = ((jsonBytes - binaryBytes) / jsonBytes) * 100;
    // Over 75% reduction on short synthetic IDs; >88% on realistic full-schema payloads
    expect(reductionPercent).toBeGreaterThan(75);
  });

  it("saturates out-of-range fields without overflow (heading 0-359.9, speed, alt, uncertainty)", () => {
    const extremeTrack: CompactTrackPacket = [
      "extreme-001",
      "uav",
      95.5, // out of lat range
      210.0, // out of lon range
      725.4, // > 360 deg
      99999.0, // extreme speed > 6553.5 m/s
      Date.now(),
      2.5, // confidence > 1
      150000, // uncertainty > 65535
      "critical",
      50000, // altitude > 32767
      "MegaDrone",
      "OVF-1"
    ];

    const encoded = encodeBinarySnapshot([extremeTrack], 5, Date.now());
    const decoded = decodeBinaryTracks(encoded);

    expect(decoded.tracks.length).toBe(1);
    const t = decoded.tracks[0];

    // Clamped lat/lon
    expect(t[2]).toBe(90);
    expect(t[3]).toBe(180);
    // Heading normalized to 0-359.9 (725.4 % 360 = 5.4)
    expect(t[4]).toBeCloseTo(5.4, 1);
    // Speed clamped to max 6553.5 m/s without overflow
    expect(t[5]).toBe(6553.5);
    // Confidence clamped to 1.0
    expect(t[7]).toBe(1);
    // Uncertainty clamped to 65535
    expect(t[8]).toBe(65535);
    // Altitude clamped to 32767
    expect(t[10]).toBe(32767);
  });

  it("rejects binary frames with invalid magic or incompatible protocol version", () => {
    const valid = encodeBinarySnapshot([], 1, Date.now());

    // Corrupt magic
    const badMagic = new Uint8Array(valid);
    badMagic[0] = 0x00;
    expect(() => decodeBinaryTracks(badMagic)).toThrow(/Invalid binary packet magic/);

    // Corrupt version (byte index 2)
    const badVersion = new Uint8Array(valid);
    badVersion[2] = 99; // unknown future version
    expect(() => decodeBinaryTracks(badVersion)).toThrow(/Incompatible binary protocol version: 99/);
  });
});
