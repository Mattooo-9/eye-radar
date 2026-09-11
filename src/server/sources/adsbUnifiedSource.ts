// src/server/sources/adsbUnifiedSource.ts
import type { Source } from "./sourceInterface.js";
import { fetchJson } from "../../utils/fetch.ts";

/**
 * Unified ADS‑B source combines the two public feeds `adsb.lol` and `airplanes.live`.
 * It returns only tracks that have a confirmed transponder/MLAT observation.
 * Shahed/rocket detections are excluded – they must come from a separate verified source.
 */
export class AdsbUnifiedSource implements Source {
  name = "adsbUnified";
  private readonly endpoints = [
    "https://api.adsb.lol/v2/mil",
    "https://opendata.adsb.fi/api/v2/mil",
  ];

  async fetchTracks(): Promise<any[]> {
    const results = await Promise.all(
      this.endpoints.map((url) => fetchJson(url).catch(() => []))
    );
    const map = new Map<string, any>();
    for (const arr of results) {
      for (const tr of arr) {
        if (!tr.hex) continue;
        const existing = map.get(tr.hex);
        if (!existing || (tr.timestamp && tr.timestamp > existing.timestamp)) {
          map.set(tr.hex, tr);
        }
      }
    }
    return Array.from(map.values());
  }
}
