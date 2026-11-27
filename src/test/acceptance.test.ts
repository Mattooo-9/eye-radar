import { afterEach, describe, expect, it } from "vitest";
import { TrackManager } from "../server/core/trackManager.js";
import { sourceRegistry } from "../server/sources/SourceRegistry.js";
import { parseOsintBulletin } from "../server/ingest/osintParser.js";
import { shouldIngestAdsbContact } from "../server/sources/adsbClassifier.js";
import { classifyAerialObject } from "../server/core/classificationEngine.js";
import {
  classifyClientDataCategory,
  formatTruthfulCoords,
  getAltitudeAnalysis,
  getHeadingVectorDescription,
  getTargetDisplayMeta
} from "../client/lib/targetSpecs.js";
import { AlertsInUaSource } from "../server/sources/alertsInUa.js";

describe("EYE RADAR — Mandatory Automated Acceptance Criteria (ACCEPTANCE.md)", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe("1. Data Truthfulness & Zero Fabrication", () => {
    it("strictly rejects synthetic observations in production mode (0 synthetic objects)", () => {
      process.env.NODE_ENV = "production";
      const tm = new TrackManager(sourceRegistry);
      const now = Date.now();
      const rejected = tm.ingest(
        {
          id: "sim-fake-1",
          type: "uav",
          lat: 50.45,
          lon: 30.52,
          heading: 270,
          speed: 52,
          timestamp: now,
          source: "simulation",
          confidence: 0.99,
          isSynthetic: true
        },
        now
      );
      expect(rejected).toBeNull();
      expect(tm.snapshot(false)).toHaveLength(0);
    });

    it("leaves unknown altitude, speed, and heading unknown for textual OSINT reports (no false precision)", () => {
      const tPub = 1_795_518_000_000;
      const parsed = parseOsintBulletin("Ударний БпЛА у районі Дергачів", tPub, tPub + 15_000);
      expect(parsed).toHaveLength(1);

      const obs = parsed[0].observation;
      expect(obs.altitude).toBeUndefined();
      expect(obs.heading).toBeUndefined();
      expect(obs.speed).toBe(0);
      expect(obs.meta?.speedIsMeasured).toBe(false);

      const tm = new TrackManager(sourceRegistry);
      const track = tm.ingest(obs, tPub + 15_000);
      expect(track).not.toBeNull();
      expect(track?.dataCategory).toBe("osint_message");
      expect(track?.altitude).toBeUndefined();
      expect(track?.measuredAltitude).toBeUndefined();
      expect(track?.measuredSpeed).toBeUndefined();
      expect(track?.measuredHeading).toBeUndefined();
      expect(track?.sources.size).toBeGreaterThan(0);
      expect(track?.provenanceChain?.length).toBeGreaterThan(0);
    });

    it("never upgrades generic 'БпЛА' OSINT messages to unconfirmed 'Shahed-136'", () => {
      const tPub = 1_795_518_000_000;
      const generic = parseOsintBulletin("БпЛА на Полтаву", tPub, tPub + 5_000);
      expect(generic).toHaveLength(1);
      expect(generic[0].observation.meta?.model).toBe("БпЛА (тип не уточнено)");

      const tm = new TrackManager(sourceRegistry);
      const track = tm.ingest(generic[0].observation, tPub + 5_000);
      expect(track?.model).toBe("БпЛА (тип не уточнено)");
      expect(track?.model).not.toContain("Shahed");

      const explicitShahed = parseOsintBulletin("Шахед курсом на Полтаву", tPub, tPub + 5_000);
      expect(explicitShahed[0].observation.meta?.model).toContain("Shahed");
    });

    it("client display metadata never invents altitudes, headings, airbases, or military units", () => {
      expect(getAltitudeAnalysis(undefined)).toBeNull();
      expect(getAltitudeAnalysis(null)).toBeNull();
      expect(getAltitudeAnalysis(0)).toBeNull();
      expect(getAltitudeAnalysis(10400)?.altitudeM).toBe(10400);

      const unknownHeading = getHeadingVectorDescription(0, false);
      expect(unknownHeading.compassShort).toBe("Невідомо");
      expect(unknownHeading.forwardSummary).toContain("невідомо");

      const osintMeta = getTargetDisplayMeta("uav", "osint-uav-kyiv-area", "БпЛА (тип не уточнено)", "@kpszsu");
      expect(osintMeta.dataCategory).toBe("osint_message");
      expect(osintMeta.dataCategoryBadge).toContain("OSINT");
      expect(classifyClientDataCategory("adsb-RCH436", "RCH436")).toBe("sensor_observation");
      expect(classifyClientDataCategory("osint-uav-kyiv-area", "@kpszsu")).toBe("osint_message");
      expect(classifyClientDataCategory("citizen-abc123")).toBe("unverified_report");

      const citizenMeta = getTargetDisplayMeta("uav", "citizen-abc123", "Неперевірене повідомлення: БпЛА (очевидець)");
      expect(citizenMeta.dataCategory).toBe("unverified_report");
      expect(citizenMeta.dataCategoryBadge).toContain("НЕПЕРЕВІРЕНЕ");

      // Coordinate precision must match spatial uncertainty (2 decimals + ~ for OSINT/unverified, 4 decimals for ADS-B)
      expect(formatTruthfulCoords(49.9935, 36.2304, "osint_message")).toBe("~49.99°N, ~36.23°E");
      expect(formatTruthfulCoords(49.9935, 36.2304, "unverified_report")).toBe("~49.99°N, ~36.23°E");
      expect(formatTruthfulCoords(47.1234, 22.4567, "sensor_observation")).toBe("47.1234°N, 22.4567°E");
    });

    it("treats alert source outage as unknown/stale state (NOT all-clear) and preserves last confirmed state + timestamp", async () => {
      const src = new AlertsInUaSource();
      const t0 = 1_795_520_000_000;
      const origFetch = globalThis.fetch;

      try {
        // 1. Initial boot while upstream is unreachable -> unavailable/unknown (NOT fresh all-clear)
        globalThis.fetch = (async () => {
          throw new Error("network down");
        }) as typeof fetch;
        await src.fetchAlerts(t0);
        const initialMeta = src.getMetadata(t0);
        expect(initialMeta.status).toBe("unavailable");
        expect(initialMeta.stale).toBe(true);
        expect(initialMeta.sourceAvailable).toBe(false);
        expect(initialMeta.lastConfirmedAt).toBeNull();

        // 2. Official source comes online with an active alert
        const t1 = t0 + 10_000;
        globalThis.fetch = (async () =>
          new Response(
            JSON.stringify({
              states: {
                "Київська область": { alertnow: true },
                "Львівська область": { alertnow: false }
              }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )) as typeof fetch;
        const confirmed = await src.fetchAlerts(t1);
        expect(confirmed.map((a) => a.name)).toEqual(["Київська область"]);
        const freshMeta = src.getMetadata(t1 + 60_000);
        expect(freshMeta.status).toBe("fresh");
        expect(freshMeta.stale).toBe(false);
        expect(freshMeta.sourceAvailable).toBe(true);
        expect(freshMeta.lastConfirmedAt).toBe(t1);

        // 3. Upstream goes down for >3 minutes -> status="stale" (unknown current state, NOT all-clear!)
        // Crucially, last confirmed oblasts and lastConfirmedAt timestamp MUST remain preserved!
        const t2 = t1 + 210_000;
        globalThis.fetch = (async () => new Response("Service Unavailable", { status: 503 })) as typeof fetch;
        const duringOutage = await src.fetchAlerts(t2);
        expect(duringOutage.map((a) => a.name)).toEqual(["Київська область"]);
        const staleMeta = src.getMetadata(t2);
        expect(staleMeta.status).toBe("stale");
        expect(staleMeta.stale).toBe(true);
        expect(staleMeta.sourceAvailable).toBe(false);
        expect(staleMeta.lastConfirmedAt).toBe(t1);
        expect(staleMeta.consecutiveFailures).toBeGreaterThanOrEqual(1);
        expect(src.getActiveAlertOblastNames()).toEqual(["Київська область"]);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("strictly separates sensor_observation from osint_message and rejects stale observations (>25s)", () => {
      const tm = new TrackManager(sourceRegistry);
      const now = 1_795_520_000_000;

      const sensorTrack = tm.ingest(
        {
          id: "adsb-RCH436",
          type: "aircraft",
          lat: 47.0,
          lon: 22.0,
          heading: 90,
          speed: 230,
          altitude: 10500,
          timestamp: now,
          source: "adsb.lol",
          confidence: 0.96,
          meta: { model: "Boeing C-17A", callsign: "RCH436" }
        },
        now
      );
      expect(sensorTrack?.dataCategory).toBe("sensor_observation");
      expect(sensorTrack?.measuredSpeed).toBe(230);
      expect(sensorTrack?.measuredAltitude).toBe(10500);

      // Observation 40s stale must be rejected (no stale ghost resurrection)
      const stale = tm.ingest(
        {
          id: "adsb-STALE1",
          type: "aircraft",
          lat: 48.0,
          lon: 25.0,
          heading: 90,
          speed: 210,
          timestamp: now - 40_000,
          source: "adsb.lol",
          confidence: 0.95
        },
        now
      );
      expect(stale).toBeNull();
    });

    it("never collapses spatial uncertainty of repeated OSINT or citizen reports below truthful bounds", () => {
      const tm = new TrackManager(sourceRegistry);
      const baseNow = 1_795_520_000_000;
      let latest = null;
      for (let i = 0; i < 6; i++) {
        const t = baseNow + i * 10_000;
        const obs = parseOsintBulletin("БпЛА курсом на Суми", t, t)[0].observation;
        latest = tm.ingest(obs, t);
      }
      expect(latest).not.toBeNull();
      expect(latest?.uncertaintyRadius).toBeGreaterThanOrEqual(3_500);
      expect(latest?.altitude).toBeUndefined();
      expect(latest?.measuredSpeed).toBeUndefined();

      let citizenTrack = null;
      for (let i = 0; i < 3; i++) {
        const t = baseNow + i * 10_000;
        citizenTrack = tm.ingest(
          {
            id: "citizen-test-1",
            type: "uav",
            lat: 49.99,
            lon: 36.23,
            heading: undefined,
            speed: 0,
            altitude: undefined,
            timestamp: t,
            source: "manual",
            confidence: 0.45,
            uncertaintyRadius: 4_500,
            meta: {
              source_id: "manual",
              speedIsMeasured: false,
              unverifiedEyewitness: true
            }
          },
          t
        );
      }
      expect(citizenTrack?.lifecycle).toBe("TENTATIVE");
      expect(citizenTrack?.dataCategory).toBe("osint_message");
      expect(citizenTrack?.evidenceFamilies).toContain("manual");
      expect(citizenTrack?.uncertaintyRadius).toBeGreaterThanOrEqual(2_500);
    });
  });

  describe("2. Architecture & Single-Source ADS-B Gate", () => {
    it("excludes European commercial airlines and foreign flights outside Ukraine, admitting only non-civil contacts inside Ukraine", () => {
      expect(shouldIngestAdsbContact(47.23, 23.32, "WZZ4848", "A321", "A21N").allowed).toBe(false);
      expect(shouldIngestAdsbContact(46.53, 22.03, "AAR522", "B77W", "B77W").allowed).toBe(false);
      expect(shouldIngestAdsbContact(44.62, 24.23, "THY4DE", "A321", "A21N").allowed).toBe(false);
      // Foreign military flight outside Ukraine border (Hungary/Romania) -> excluded
      expect(shouldIngestAdsbContact(47.0, 21.8, "RCH436", "Boeing C-17A Globemaster III", "C17").allowed).toBe(false);
      // Military/non-civil contact strictly inside Ukraine -> allowed
      expect(shouldIngestAdsbContact(50.45, 30.52, "RCH436", "Boeing C-17A Globemaster III", "C17").allowed).toBe(true);
      // Commercial airliner inside Ukraine -> excluded
      expect(shouldIngestAdsbContact(50.45, 30.52, "WZZ4848", "A321", "A21N").allowed).toBe(false);
    });

    it("prevents unbounded evidence array growth across repeated classification cycles", () => {
      let ev: string[] = ["official_air_force_bulletin", "air_defense_osint"];
      let th: string[] = ["official_air_force_bulletin"];
      for (let i = 0; i < 40; i++) {
        const out = classifyAerialObject({
          claimedType: "uav",
          speedMs: 0,
          headingDeg: 0,
          sources: ["osint"],
          evidence: ev,
          threatEvidence: th,
          modelHint: "Ударний БпЛА (OSINT)"
        });
        ev = out.evidence;
        th = out.threatEvidence;
      }
      expect(ev.length).toBeLessThanOrEqual(24);
      expect(th.length).toBeLessThanOrEqual(24);
    });
  });

  describe("5. Autonomy, Failure Resiliency & Clean Checkpoint Recovery", () => {
    it("operates cleanly with 0 tracks when upstream feeds return empty and prunes expired tracks automatically", () => {
      const tm = new TrackManager(sourceRegistry);
      const now = 1_795_520_000_000;
      tm.tick(now);
      tm.prune(now);
      expect(tm.snapshot(false)).toHaveLength(0);

      const obs = parseOsintBulletin("Ударний БпЛА біля Харкова", now, now)[0].observation;
      tm.ingest(obs, now);
      expect(tm.snapshot(false)).toHaveLength(1);

      // Area-only OSINT track (speed=0) survives normal 20s ticks without false stationary-kill
      tm.tick(now + 20_000);
      tm.prune(now + 20_000);
      expect(tm.snapshot(false)).toHaveLength(1);

      // Expires cleanly after > 45s without fresh update
      tm.prune(now + 50_000);
      expect(tm.snapshot(false)).toHaveLength(0);
    });

    it("skips degraded, synthetic, and stale tracks on checkpoint restoration", () => {
      const tm = new TrackManager(sourceRegistry);
      const now = Date.now();
      const restored = tm.restoreFromCheckpoint({
        sequenceId: 500,
        timestamp: now,
        tracks: [
          {
            id: "fake-synth",
            type: "uav",
            lat: 50.4,
            lon: 30.5,
            heading: 0,
            speed: 50,
            timestamp: now,
            confidence: 0.9,
            sources: new Set(["simulation"]),
            isSynthetic: true
          },
          {
            id: "ew-corrupted",
            type: "aircraft",
            lat: 48.0,
            lon: 22.0,
            heading: 90,
            speed: 220,
            timestamp: now,
            confidence: 0.25,
            sources: new Set(["adsb.lol"]),
            model: "Невідома повітряна ціль (аномальний стрибок РЕБ)",
            isDegraded: true,
            isSynthetic: false
          },
          {
            id: "osint-uav-legacy-ckpt",
            type: "uav",
            dataCategory: "osint_message",
            lat: 49.99,
            lon: 36.23,
            heading: 0,
            speed: 0,
            altitude: 350,
            measuredAltitude: 350,
            measuredSpeed: 125,
            timestamp: now - 5_000,
            confidence: 0.85,
            sources: new Set(["osint"]),
            model: "Ударний БпЛА (OSINT)",
            isSynthetic: false
          }
        ]
      });
      expect(restored).toBe(1);
      const restoredTrack = tm.getTrack("osint-uav-legacy-ckpt");
      expect(restoredTrack).toBeDefined();
      expect(restoredTrack?.altitude).toBeUndefined();
      expect(restoredTrack?.measuredAltitude).toBeUndefined();
      expect(restoredTrack?.measuredSpeed).toBeUndefined();
      expect(tm.getTrack("fake-synth")).toBeUndefined();
      expect(tm.getTrack("ew-corrupted")).toBeUndefined();
    });
  });
});
