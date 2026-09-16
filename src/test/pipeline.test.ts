import { describe, expect, it } from "vitest";
import { StorageManager } from "../server/core/storage.js";
import { ThreatEngine } from "../server/core/threatEngine.js";
import { TrackManager } from "../server/core/trackManager.js";
import type { Observation } from "../server/domain/types.js";
import { parseOsintText } from "../server/ingest/osintParser.js";
import { SourceHealthTracker } from "../server/sources/sourceHealth.js";

describe("E2E Pipeline Integration Test", () => {
  it("processes end-to-end data flow: OSINT ingest -> correlation -> Kalman tracking -> threat eval -> storage", () => {
    const trackManager = new TrackManager();
    const threatEngine = new ThreatEngine();
    const healthTracker = new SourceHealthTracker();
    const storage = new StorageManager();

    healthTracker.registerSource("osint");
    healthTracker.registerSource("sdr");

    // 1. Natural language OSINT message
    const osintRaw = "⚠️ Помічено шахеди біля Кременчука, вектор на Полтаву";
    const osintObs = parseOsintText(osintRaw, Date.now());
    expect(osintObs.length).toBeGreaterThan(0);

    // 2. Ingest into TrackManager
    for (const obs of osintObs) {
      trackManager.ingest(obs);
    }
    healthTracker.recordSuccess("osint", 2);

    // 3. Correlated second observation (e.g. sensor confirmation 2 km away)
    const sensorObs: Observation = {
      id: "sensor-confirm-01",
      type: "uav",
      lat: osintObs[0].lat + 0.01,
      lon: osintObs[0].lon + 0.01,
      heading: osintObs[0].heading ?? 45,
      speed: 48,
      timestamp: Date.now(),
      source: "sdr",
      confidence: 0.85
    };

    trackManager.ingest(sensorObs);
    healthTracker.recordSuccess("sdr", 3);

    // Verify tracks snapshot
    const activeTracks = trackManager.snapshot();
    expect(activeTracks.length).toBe(1); // Correlated into single track!
    const track = activeTracks[0];
    expect(track.sources.has("osint")).toBe(true);
    expect(track.sources.has("sdr")).toBe(true);
    expect(track.confidence).toBeGreaterThan(0.75); // Multi-source confidence boost

    // 4. Verify compact packet output
    const packets = trackManager.toPackets();
    expect(packets.length).toBe(1);
    expect(packets[0][0]).toBe(track.id);
    expect(packets[0][1]).toBe("uav");

    // 5. Threat evaluation for user in Poltava (where target is heading)
    const poltavaUser = { lat: 49.5883, lon: 34.5514 };
    const threat = threatEngine.evaluateThreat(track, poltavaUser);
    expect(threat.distanceMeters).toBeGreaterThan(0);
    expect(threat.distanceMeters).toBeLessThan(120_000);

    // 6. User preference storage
    storage.savePreference({
      chatId: 999111,
      lat: poltavaUser.lat,
      lon: poltavaUser.lon,
      radiusKm: 50,
      enabled: true
    });

    const loaded = storage.getPreference(999111);
    expect(loaded).toBeDefined();
    expect(loaded?.radiusKm).toBe(50);
    expect(loaded?.lat).toBe(poltavaUser.lat);

    // Clean up test user
    storage.deletePreference(999111);
    expect(storage.getPreference(999111)).toBeUndefined();

    // 7. Source health validation
    const statuses = healthTracker.getStatuses();
    const osintStatus = statuses.find((s) => s.name === "osint");
    const sdrStatus = statuses.find((s) => s.name === "sdr");
    expect(osintStatus).toBeDefined();
    expect(sdrStatus).toBeDefined();
    expect(osintStatus?.status).toBe("online");
    expect(sdrStatus?.status).toBe("online");
  });
});
