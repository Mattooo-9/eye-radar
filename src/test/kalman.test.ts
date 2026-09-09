import { describe, expect, it } from "vitest";
import { KalmanFilter2D } from "../server/core/kalman.js";

describe("KalmanFilter2D", () => {
  it("initializes with measurement and zero velocity", () => {
    const kf = new KalmanFilter2D();
    const result = kf.update(1000, 50.45, 30.52);

    expect(result.lat).toBe(50.45);
    expect(result.lon).toBe(30.52);
    expect(result.velocityLat).toBe(0);
    expect(result.velocityLon).toBe(0);
    expect(result.uncertaintyRadiusMeters).toBeGreaterThan(100);
  });

  it("smooths noisy measurements and estimates velocity", () => {
    const kf = new KalmanFilter2D();

    // Constant northward movement: ~0.001 deg/sec
    kf.update(1000, 50.000, 30.000);
    kf.update(2000, 50.001, 30.000);
    const r3 = kf.update(3000, 50.0021, 30.0001);

    expect(r3.velocityLat).toBeGreaterThan(0.0005);
    expect(r3.lat).toBeCloseTo(50.002, 2);
  });

  it("predicts position forward when no measurements arrive", () => {
    const kf = new KalmanFilter2D();
    kf.update(1000, 50.0, 30.0);
    kf.update(2000, 50.01, 30.0);

    const predicted = kf.predict(4000);
    expect(predicted).not.toBeNull();
    if (predicted) {
      expect(predicted.lat).toBeGreaterThan(50.01);
      expect(predicted.uncertaintyRadiusMeters).toBeGreaterThan(0);
    }
  });
});
