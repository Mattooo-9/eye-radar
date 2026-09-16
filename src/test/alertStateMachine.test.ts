import { describe, expect, it, beforeEach } from "vitest";
import { AlertStateMachine, COOLDOWN_PER_TRACK_MS } from "../server/core/alertStateMachine.js";
import type { TrackState, UserAlertPreference } from "../server/domain/types.js";

describe("Alert State Machine (NEW -> APPROACHING -> CRITICAL -> PASSED/CLEARED)", () => {
  let sm: AlertStateMachine;
  const userPref: UserAlertPreference = {
    chatId: 123456,
    lat: 50.45,
    lon: 30.52, // Kyiv center
    radiusKm: 25,
    enabled: true
  };

  beforeEach(() => {
    sm = new AlertStateMachine();
  });

  it("transitions smoothly: NEW -> APPROACHING -> CRITICAL -> PASSED -> CLEARED", () => {
    const t0 = 1700000000000;

    // 1. Target detected far away (30 km away) -> NEW state, silent initial
    const trackNew: TrackState = {
      id: "uav-test-01",
      type: "uav",
      lat: 50.45 + 30 / 111,
      lon: 30.52,
      heading: 180, // flying South towards user
      speed: 50,
      timestamp: t0,
      confidence: 0.95,
      threatLevel: "high",
      uncertaintyRadius: 30,
      model: "Shahed-136",
      sources: new Set(["sdr"])
    };

    const resNew = sm.evaluateTrack(userPref, trackNew, t0);
    expect(resNew.state).toBe("NEW");
    expect(resNew.shouldNotify).toBe(false);

    // 2. Target closes in to 15 km away -> APPROACHING, triggers notification
    const t1 = t0 + 300_000;
    const trackApproaching: TrackState = {
      ...trackNew,
      lat: 50.45 + 15 / 111,
      timestamp: t1
    };

    const resAppr = sm.evaluateTrack(userPref, trackApproaching, t1);
    expect(resAppr.state).toBe("APPROACHING");
    expect(resAppr.previousState).toBe("NEW");
    expect(resAppr.shouldNotify).toBe(true);

    // 3. Duplicate evaluation within 10 seconds (still approaching) -> deduplicated!
    const t2 = t1 + 10_000;
    const trackDuplicate: TrackState = {
      ...trackApproaching,
      lat: 50.45 + 14.5 / 111,
      timestamp: t2
    };
    const resDup = sm.evaluateTrack(userPref, trackDuplicate, t2);
    expect(resDup.state).toBe("APPROACHING");
    expect(resDup.shouldNotify).toBe(false);
    expect(resDup.reason).toBe("dedup_state_unchanged");

    // 4. Target enters immediate danger radius (3.5 km) -> CRITICAL, triggers notification
    const t3 = t1 + COOLDOWN_PER_TRACK_MS + 5000;
    const trackCritical: TrackState = {
      ...trackNew,
      lat: 50.45 + 3.5 / 111,
      timestamp: t3
    };
    const resCrit = sm.evaluateTrack(userPref, trackCritical, t3);
    expect(resCrit.state).toBe("CRITICAL");
    expect(resCrit.previousState).toBe("APPROACHING");
    expect(resCrit.shouldNotify).toBe(true);

    // 5. Target flies over and turns away (distance increases to 7 km, divergent) -> PASSED
    const t4 = t3 + COOLDOWN_PER_TRACK_MS + 10000;
    const trackPassed: TrackState = {
      ...trackNew,
      lat: 50.45 - 7 / 111,
      heading: 180, // heading away to the South
      timestamp: t4
    };
    const resPassed = sm.evaluateTrack(userPref, trackPassed, t4);
    expect(resPassed.state).toBe("PASSED");
    expect(resPassed.previousState).toBe("CRITICAL");
    expect(resPassed.shouldNotify).toBe(true);

    // 6. Target leaves region completely (55 km away) -> CLEARED
    const t5 = t4 + COOLDOWN_PER_TRACK_MS + 20000;
    const trackCleared: TrackState = {
      ...trackNew,
      lat: 50.45 - 55 / 111,
      timestamp: t5
    };
    const resCleared = sm.evaluateTrack(userPref, trackCleared, t5);
    expect(resCleared.state).toBe("CLEARED");
    expect(resCleared.shouldNotify).toBe(true);
  });

  it("respects per-trackId cooldown and deduplicates repeated alerts", () => {
    const t0 = 1700000000000;

    const track: TrackState = {
      id: "uav-cooldown-test",
      type: "uav",
      lat: 50.45 + 10 / 111,
      lon: 30.52,
      heading: 180,
      speed: 48,
      timestamp: t0,
      confidence: 0.95,
      threatLevel: "high",
      sources: new Set(["sdr"])
    };

    // First approaching notification
    const res1 = sm.evaluateTrack(userPref, track, t0);
    expect(res1.shouldNotify).toBe(true);

    // Immediate repeat attempt (30 seconds later)
    const res2 = sm.evaluateTrack(userPref, track, t0 + 30_000);
    expect(res2.shouldNotify).toBe(false);

    // After cooldown period (65 seconds later), state is still unchanged -> still no repeat spam
    const res3 = sm.evaluateTrack(userPref, track, t0 + 65_000);
    expect(res3.shouldNotify).toBe(false);
  });
});
