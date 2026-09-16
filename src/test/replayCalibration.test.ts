import { describe, expect, it } from "vitest";
import { runReplayBenchmark, generateReplayDataset } from "../server/core/replayBenchmark.js";
import { timeCalibrationService } from "../server/core/timeCalibration.js";

describe("Replay Calibration & Metric Verification", () => {
  it("generates realistic replay dataset with consistent ground truth", () => {
    const { groundTruth, observations } = generateReplayDataset(30, 2);
    expect(groundTruth.length).toBeGreaterThan(0);
    expect(observations.length).toBe(groundTruth.length);

    // Verify clock offset applied to raw observations
    const sampleObs = observations[0];
    const sampleGt = groundTruth[0];
    expect(sampleObs.timestamp).toBeLessThan(sampleGt.time);
  });

  it("calculates time metrics, jitter, and confidence score correctly", () => {
    timeCalibrationService.reset();
    const now = 1700000010000;

    // Simulate 5 consecutive packets with 120ms network latency and 400ms clock offset
    for (let i = 0; i < 5; i++) {
      const obsTime = now - 520 + (i % 2 === 0 ? 10 : -10);
      const pubTime = now - 120;
      const recTime = now;
      const res = timeCalibrationService.recordAndCalibrate("test.feed", obsTime, recTime, pubTime);
      expect(res.calibratedTime).toBeGreaterThanOrEqual(obsTime);
      expect(res.calibratedTime).toBeLessThanOrEqual(recTime);
    }

    const metrics = timeCalibrationService.getMetrics("test.feed");
    expect(metrics).toBeDefined();
    expect(metrics?.sampleCount).toBe(5);
    expect(metrics?.timeConfidence).toBeGreaterThan(0.5);
    expect(metrics?.p50LatencyMs).toBeGreaterThan(0);
  });

  it("runs replay benchmark and verifies zero metric degradation", () => {
    const report = runReplayBenchmark();

    expect(report.passed).toBe(true);

    // 1. Position Error target: < 150m, improved over baseline
    expect(report.calibrated.positionErrorMeters).toBeLessThanOrEqual(report.baseline.positionErrorMeters);
    expect(report.calibrated.positionErrorMeters).toBeLessThan(150);
    expect(report.deltas.positionErrorImprovementMeters).toBeGreaterThan(0);

    // 2. Speed Error target: < 5.0 m/s
    expect(report.calibrated.speedErrorMs).toBeLessThan(5.0);

    // 3. Track fragmentation: strictly 0
    expect(report.calibrated.trackFragmentation).toBe(0);

    // 4. False merges: strictly 0
    expect(report.calibrated.falseMerges).toBe(0);

    // 5. Classification flips: strictly 0
    expect(report.calibrated.classificationFlips).toBe(0);

    // 6. Latency percentiles: ultra-low overhead
    expect(report.calibrated.latencyP50Ms).toBeLessThan(10.0);
    expect(report.calibrated.latencyP95Ms).toBeLessThan(25.0);
  });
});
