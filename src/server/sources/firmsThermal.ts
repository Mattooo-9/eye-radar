import type { Observation } from "../domain/types.js";

export class FirmsThermalSource {
  private lastFetch = 0;
  private readonly mapKey?: string;

  constructor(mapKey?: string) {
    this.mapKey = mapKey;
  }

  async fetchThermalObservations(): Promise<Observation[]> {
    const now = Date.now();
    // Cache for 2 minutes to prevent rate limits
    if (now - this.lastFetch < 120_000) {
      return [];
    }

    if (!this.mapKey) {
      return [];
    }

    try {
      // VIIRS NRT 24h over Ukraine bounding box: 22,44,40,52
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${this.mapKey}/VIIRS_SNPP_NRT/22,44,40,52/1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return [];

      const text = await res.text();
      const lines = text.trim().split("\n");
      const observations: Observation[] = [];

      // CSV format: latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
      for (let i = 1; i < Math.min(lines.length, 50); i++) {
        const parts = lines[i].split(",");
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        const bright = parseFloat(parts[2]);

        // Filter for intense thermal anomalies
        if (lat && lon && bright > 330) {
          observations.push({
            id: `firms-${lat.toFixed(3)}-${lon.toFixed(3)}`,
            type: "thermal",
            lat,
            lon,
            heading: 0,
            speed: 0,
            timestamp: now,
            source: "firms",
            confidence: Math.min(0.9, (bright - 300) / 100),
            meta: {
              brightness: bright
            }
          });
        }
      }

      this.lastFetch = now;
      return observations;
    } catch {
      return [];
    }
  }
}
