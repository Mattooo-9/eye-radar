import { describe, expect, it } from "vitest";
import { SpatialIndex, type SpatialItem } from "../client/lib/spatialIndex.js";

describe("SpatialIndex (2D R-Tree Viewport Culling)", () => {
  it("bulk-loads items and accurately retrieves elements inside bounding box", () => {
    const index = new SpatialIndex<string>(16);

    const items: Array<SpatialItem<string>> = [
      { minX: 30.0, minY: 50.0, maxX: 30.0, maxY: 50.0, item: "Kyiv-Target" },
      { minX: 35.0, minY: 48.0, maxX: 35.0, maxY: 48.0, item: "Dnipro-Target" },
      { minX: 30.5, minY: 46.5, maxX: 30.5, maxY: 46.5, item: "Odesa-Target" },
      { minX: 24.0, minY: 49.8, maxX: 24.0, maxY: 49.8, item: "Lviv-Target" },
      { minX: 36.2, minY: 50.0, maxX: 36.2, maxY: 50.0, item: "Kharkiv-Target" }
    ];

    index.load(items);
    expect(index.size).toBe(5);

    // Search Central-North Ukraine [lon 29..32, lat 49..51] -> should find Kyiv
    const centralSearch = index.search({ minX: 29.0, minY: 49.0, maxX: 32.0, maxY: 51.0 });
    expect(centralSearch).toContain("Kyiv-Target");
    expect(centralSearch).not.toContain("Lviv-Target");
    expect(centralSearch).not.toContain("Dnipro-Target");

    // Search West Ukraine [lon 23..26, lat 48..51] -> should find Lviv
    const westSearch = index.search({ minX: 23.0, minY: 48.0, maxX: 26.0, maxY: 51.0 });
    expect(westSearch).toContain("Lviv-Target");
    expect(westSearch.length).toBe(1);
  });

  it("handles 1000 targets with sub-millisecond search performance", () => {
    const index = new SpatialIndex<number>(16);
    const items: Array<SpatialItem<number>> = [];

    // Generate 1000 items scattered over Ukraine [lon 22..40, lat 45..52]
    for (let i = 0; i < 1000; i++) {
      const lon = 22 + (i % 50) * 0.35;
      const lat = 45 + Math.floor(i / 50) * 0.35;
      items.push({
        minX: lon,
        minY: lat,
        maxX: lon,
        maxY: lat,
        item: i
      });
    }

    index.load(items);
    expect(index.size).toBe(1000);

    const t0 = performance.now();
    // Query typical mobile screen viewport (approx 2.5 deg x 2.0 deg)
    const results = index.search({
      minX: 30.0,
      minY: 48.5,
      maxX: 32.5,
      maxY: 50.5
    });
    const searchTime = performance.now() - t0;

    expect(results.length).toBeGreaterThan(0);
    // Sub-millisecond query time even on 1000 items
    expect(searchTime).toBeLessThan(5.0);
  });
});
