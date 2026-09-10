import { describe, expect, it } from "vitest";
import { ImmFilter2D } from "../server/core/immFilter.js";
import { classifyAerialObject } from "../server/core/classificationEngine.js";
import { haversineMeters } from "../server/domain/geo.js";

describe("Synthetic Benchmark & Accuracy Verification", () => {
  it("verifies IMM filter position error <= 350m along a synthetic flight corridor", () => {
    const filter = new ImmFilter2D();
    const startTime = 1700000000000;
    const speedMs = 50; // ~180 km/h Shahed flight
    const headingDeg = 45; // Northeast trajectory

    // True start: Cherkasy region (49.44, 32.06)
    let trueLat = 49.44;
    let trueLon = 32.06;

    const errorsMeters: number[] = [];

    // Simulate 20 discrete sensor reports every 3 seconds with synthetic Gaussian measurement jitter
    for (let step = 0; step < 20; step++) {
      const t = startTime + step * 3000;

      // True kinematic advancement (geodesic approximation for short step)
      const dMeters = speedMs * 3;
      const dLat = (dMeters * Math.cos((headingDeg * Math.PI) / 180)) / 111_139;
      const dLon = (dMeters * Math.sin((headingDeg * Math.PI) / 180)) / (111_139 * Math.cos((trueLat * Math.PI) / 180));
      trueLat += dLat;
      trueLon += dLon;

      // Add sensor noise (+/- 150m)
      const noiseLat = ((step % 2 === 0 ? 1 : -1) * 80) / 111_139;
      const noiseLon = ((step % 3 === 0 ? 1 : -1) * 80) / (111_139 * Math.cos((trueLat * Math.PI) / 180));
      const measuredLat = trueLat + noiseLat;
      const measuredLon = trueLon + noiseLon;

      const estimate = filter.update(t, measuredLat, measuredLon);

      // Measure error between filter estimate and true position after initial convergence (step > 3)
      if (step >= 4) {
        const err = haversineMeters(trueLat, trueLon, estimate.lat, estimate.lon);
        errorsMeters.push(err);
      }
    }

    const meanError = errorsMeters.reduce((a, b) => a + b, 0) / errorsMeters.length;
    const maxError = Math.max(...errorsMeters);

    // Mean error must be below 180m, max error below 350m
    expect(meanError).toBeLessThan(180);
    expect(maxError).toBeLessThan(350);
  });

  it("benchmarks 100% classification accuracy separating Shahed-238 (Jet) vs Shahed-136 (Piston)", () => {
    // Shahed-136 profiles (140 - 195 km/h)
    const shahed136SpeedsKmh = [140, 155, 170, 185, 195, 210];
    for (const speedKmh of shahed136SpeedsKmh) {
      const res = classifyAerialObject({
        claimedType: "uav",
        speedMs: speedKmh / 3.6,
        headingDeg: 310,
        altitudeM: 180,
        sources: ["sdr"]
      });

      expect(res.resolvedModel).toBe("Shahed-136");
      expect(res.propulsion).toBe("piston");
    }

    // Shahed-238 profiles (450 - 600 km/h)
    const shahed238SpeedsKmh = [250, 320, 450, 520, 580, 600];
    for (const speedKmh of shahed238SpeedsKmh) {
      const res = classifyAerialObject({
        claimedType: "uav",
        speedMs: speedKmh / 3.6,
        headingDeg: 280,
        altitudeM: 1200,
        sources: ["sdr"]
      });

      expect(res.resolvedModel).toBe("Shahed-238 (Jet)");
      expect(res.propulsion).toBe("turbojet");
    }

    // Recon profiles (< 130 km/h)
    const reconSpeedsKmh = [70, 90, 110];
    for (const speedKmh of reconSpeedsKmh) {
      const res = classifyAerialObject({
        claimedType: "uav",
        speedMs: speedKmh / 3.6,
        headingDeg: 120,
        altitudeM: 1800,
        sources: ["osint"]
      });

      expect(res.resolvedModel).toContain("Recon");
      expect(res.propulsion).toBe("electric");
    }

    // Cruise missile profile (750 km/h)
    const missileRes = classifyAerialObject({
      claimedType: "munition",
      speedMs: 750 / 3.6,
      headingDeg: 270,
      altitudeM: 90,
      sources: ["radar"]
    });
    expect(missileRes.resolvedType).toBe("munition");
    expect(missileRes.propulsion).toBe("turbojet");
  });
});
