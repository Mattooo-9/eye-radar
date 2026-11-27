import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PMTiles } from "pmtiles";
import {
  OPENFREEMAP_DARK_STYLE_URL,
  buildProtomapsDarkStyle,
  buildRealisticSatelliteStyle,
  resolveMapStyle
} from "../client/lib/mapStyles.js";

describe("Stage 4 — Protomaps / PMTiles Basemap Optimization", () => {
  it("builds a valid MapLibre v8 Protomaps dark style with Ukrainian localization", () => {
    const style = buildProtomapsDarkStyle("https://eye-radar.vercel.app/tiles/ukraine-overview.pmtiles");
    expect(style.version).toBe(8);
    expect((style.sources.protomaps as any).type).toBe("vector");
    expect((style.sources.protomaps as any).url).toBe(
      "pmtiles://https://eye-radar.vercel.app/tiles/ukraine-overview.pmtiles"
    );
    expect(style.layers.length).toBeGreaterThan(20);
    // Ensure Ukrainian language expression is present in place labels
    const serialized = JSON.stringify(style.layers);
    expect(serialized).toContain("name:uk");
  });

  it("builds a realistic Esri + Protomaps PMTiles satellite style without unofficial Google tiles", () => {
    const normalStyle = buildRealisticSatelliteStyle({ performanceTier: "NORMAL" });
    const lowStyle = buildRealisticSatelliteStyle({ performanceTier: "LOW" });
    const serialized = JSON.stringify(normalStyle);

    expect(serialized).not.toContain("mt0.google.com");
    expect(serialized).not.toContain("mt1.google.com");
    expect(serialized).toContain("server.arcgisonline.com/ArcGIS/rest/services/World_Imagery");
    expect(serialized).toContain("pmtiles://");
    expect((lowStyle.sources["satellite-tiles"] as any).maxzoom).toBe(12);
    expect((normalStyle.sources["satellite-tiles"] as any).maxzoom).toBe(17);
  });

  it("switches cleanly between realistic satellite, OpenFreeMap vector, custom PMTiles, and offline local PMTiles", () => {
    const sat = resolveMapStyle({ visionMode: "satellite", performanceTier: "NORMAL" });
    expect(sat.styleKey).toContain("satellite-esri-pmtiles");

    const tactical = resolveMapStyle({ visionMode: "tactical", performanceTier: "NORMAL" });
    expect(tactical.style).toBe(OPENFREEMAP_DARK_STYLE_URL);

    const customPm = resolveMapStyle({
      visionMode: "tactical",
      performanceTier: "NORMAL",
      pmtilesUrl: "https://cdn.example.com/ukraine.pmtiles"
    });
    expect(typeof customPm.style).toBe("object");
    expect(((customPm.style as any).sources.protomaps as any).url).toBe(
      "pmtiles://https://cdn.example.com/ukraine.pmtiles"
    );

    const offlineFallback = resolveMapStyle({
      visionMode: "satellite",
      performanceTier: "NORMAL",
      preferLocalPmtiles: true
    });
    expect(offlineFallback.styleKey).toContain("pmtiles-local");
    expect(typeof offlineFallback.style).toBe("object");
  });

  it("ships a valid, byte-readable self-hosted Ukraine Protomaps PMTiles v3 archive", async () => {
    const archivePath = resolve(process.cwd(), "public/tiles/ukraine-overview.pmtiles");
    expect(existsSync(archivePath)).toBe(true);

    const buf = readFileSync(archivePath);
    expect(buf.byteLength).toBeGreaterThan(100_000);
    expect(buf.byteLength).toBeLessThan(2_500_000); // lean < 2.5 MB budget

    const archive = new PMTiles({
      getKey: () => archivePath,
      async getBytes(offset: number, length: number) {
        const slice = buf.subarray(offset, offset + length);
        return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) };
      }
    });
    const header = await archive.getHeader();
    expect(header.specVersion).toBe(3);
    expect(header.minZoom).toBe(0);
    expect(header.maxZoom).toBeGreaterThanOrEqual(5);

    // Kyiv tile at z5: x=18, y=10
    const kyivTile = await archive.getZxy(5, 18, 10);
    expect(kyivTile?.data?.byteLength).toBeGreaterThan(1000);
  });
});
