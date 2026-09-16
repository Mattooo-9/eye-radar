import { describe, expect, it } from "vitest";
import {
  wgs84ToWebMercator,
  tileToBbox,
  applyPansharpening,
  applyLeeFilter,
  detectRealPixelChanges,
  generateDisplayOnlySuperResolution
} from "../server/sources/cloudEoPipeline.js";

describe("Cloud EO Pipeline & Real-Pixel Computer Vision", () => {
  it("computes Web Mercator projection and tile bounding boxes accurately", () => {
    // Kyiv center ~ (50.4501, 30.5234)
    const [x, y] = wgs84ToWebMercator(50.4501, 30.5234);
    expect(x).toBeGreaterThan(3300000);
    expect(y).toBeGreaterThan(6500000);

    // Standard zoom 10 tile
    const [minLon, minLat, maxLon, maxLat] = tileToBbox(10, 598, 350);
    expect(minLon).toBeLessThan(maxLon);
    expect(minLat).toBeLessThan(maxLat);
    expect(minLon).toBeGreaterThan(29.0);
    expect(maxLon).toBeLessThan(32.0);
  });

  it("applies Brovey pansharpening ONLY when genuine PAN channel exists", () => {
    const multispectral = {
      red: [[100, 120], [110, 130]],
      green: [[90, 110], [100, 120]],
      blue: [[80, 100], [90, 110]]
    };

    // Case 1: PAN channel is undefined or empty -> preserves native resolution without fabrication
    const withoutPan = applyPansharpening(multispectral);
    expect(withoutPan.sharpened).toBe(false);
    expect(withoutPan.red).toEqual(multispectral.red);
    expect(withoutPan.message).toContain("Native multispectral resolution preserved");

    // Case 2: Genuine 4x4 PAN channel present -> applies pansharpening
    const pan = [
      [150, 160, 170, 180],
      [155, 165, 175, 185],
      [140, 150, 160, 170],
      [145, 155, 165, 175]
    ];
    const withPan = applyPansharpening(multispectral, pan);
    expect(withPan.sharpened).toBe(true);
    expect(withPan.red.length).toBe(4);
    expect(withPan.red[0].length).toBe(4);
    expect(withPan.message).toContain("Brovey pansharpening applied");
  });

  it("applies Adaptive Lee Filter on SAR speckle noise while preserving structure", () => {
    // Generate 5x5 SAR matrix with speckle noise around background level 100
    // and a strong reflective target (backscatter = 240) in the center
    const sarInput: number[][] = [
      [102, 95, 108, 98, 101],
      [97, 110, 94, 106, 99],
      [104, 96, 240, 101, 103], // target at (2, 2)
      [99, 105, 98, 107, 95],
      [101, 97, 103, 99, 100]
    ];

    const filtered = applyLeeFilter(sarInput, 3);
    expect(filtered.length).toBe(5);
    expect(filtered[0].length).toBe(5);

    // Target backscatter remains elevated (structure preserved)
    expect(filtered[2][2]).toBeGreaterThan(150);

    // Uniform background noise variance is reduced
    const bgVal = filtered[0][0];
    expect(bgVal).toBeGreaterThanOrEqual(95);
    expect(bgVal).toBeLessThanOrEqual(105);
  });

  it("detects real-pixel changes with factual coordinates and non-AI provenance", () => {
    const size = 10;
    const baseline: number[][] = Array.from({ length: size }, () => new Array(size).fill(50));
    const current: number[][] = Array.from({ length: size }, () => new Array(size).fill(50));

    // Introduce significant localized thermal/optical disturbance at (3, 4)
    current[3][4] = 180;
    current[3][5] = 175;

    const result = detectRealPixelChanges(baseline, current, 30, { lat: 48.45, lon: 35.05 }, 10);
    expect(result.changedPixelCount).toBe(2);
    expect(result.changeRatio).toBeGreaterThan(0);
    expect(result.anomalies.length).toBeGreaterThan(0);

    // Check strict provenance and non-hallucinated flag
    const anomaly = result.anomalies[0];
    expect(anomaly.isDisplayOnlyAI).toBe(false); // MUST NOT be display AI
    expect(anomaly.confidence).toBeGreaterThan(0.7);
    expect(anomaly.approxCoordinates.lat).toBeCloseTo(48.45, 1);
    expect(anomaly.approxCoordinates.lon).toBeCloseTo(35.05, 1);
  });

  it("flags AI super-resolution strictly as display-only and non-evidentiary", () => {
    const rawMatrix = [
      [50, 100],
      [150, 200]
    ];

    const srResult = generateDisplayOnlySuperResolution(rawMatrix, 2);
    expect(srResult.isDisplayOnlyAI).toBe(true);
    expect(srResult.warning).toContain("DISPLAY-ONLY ARTIFACT");
    expect(srResult.displayRaster.length).toBe(4);
    expect(srResult.displayRaster[0].length).toBe(4);
  });
});
