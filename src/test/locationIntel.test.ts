import { describe, expect, it } from "vitest";
import { detectRegionFromCoordinates, isAlertActiveForRegion, getLocationIntel } from "../client/lib/locationIntel";
import type { TrackPacket } from "../client/hooks/useWsRadar";

describe("locationIntel", () => {
  it("detects Ukrainian oblast by coordinates", () => {
    expect(detectRegionFromCoordinates(50.45, 30.52)).toBe("Київська область");
    expect(detectRegionFromCoordinates(48.46, 35.04)).toBe("Дніпропетровська область");
    expect(detectRegionFromCoordinates(49.99, 36.23)).toBe("Харківська область");
  });

  it("accurately matches region alert names from alerts.in.ua feed", () => {
    const activeAlerts = [
      "Дніпропетровська область",
      "Харківська область",
      "Сумська область",
      "Севастополь"
    ];

    expect(isAlertActiveForRegion("Дніпропетровська область", activeAlerts)).toBe(true);
    expect(isAlertActiveForRegion("Дніпропетровська обл.", activeAlerts)).toBe(true);
    expect(isAlertActiveForRegion("АР Крим", activeAlerts)).toBe(true);
    expect(isAlertActiveForRegion("Львівська область", activeAlerts)).toBe(false);
  });

  it("calculates nearby threats and ETA for selected location", () => {
    const now = Date.now();
    // Shahed drone 15 km south of Kyiv (lat 50.45, lon 30.52), heading North (0 deg) towards Kyiv at 50 m/s (~180 km/h)
    const dronePacket: TrackPacket = [
      "uav-1",
      "uav",
      50.315, // ~15 km south
      30.52,
      0, // heading North towards Kyiv
      50, // 50 m/s = 180 km/h
      now,
      0.95,
      25,
      "CRITICAL",
      150
    ];

    const intel = getLocationIntel(50.45, 30.52, ["Київська область"], [dronePacket], 60);

    expect(intel.hasActiveAlert).toBe(true);
    expect(intel.regionName).toBe("Київська область");
    expect(intel.nearbyThreats.length).toBe(1);
    expect(intel.closestThreat).not.toBeNull();
    expect(intel.closestThreat?.isApproaching).toBe(true);
    expect(intel.closestThreat?.etaMinutes).toBeGreaterThanOrEqual(4);
    expect(intel.closestThreat?.etaMinutes).toBeLessThanOrEqual(6);
    expect(intel.summaryStatus).toBe("CRITICAL");
  });
});
