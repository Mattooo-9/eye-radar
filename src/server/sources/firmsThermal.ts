import type { Observation } from "../domain/types.js";

export class FirmsThermalSource {
  private lastFetch = 0;
  private readonly mapKey?: string;

  constructor(mapKey?: string) {
    this.mapKey = mapKey;
  }

  async fetchThermalObservations(): Promise<Observation[]> {
    const now = Date.now();
    // Cache for 60 seconds to respect rate limits
    if (now - this.lastFetch < 60_000) {
      return [];
    }

    try {
      let text = "";
      if (this.mapKey) {
        try {
          const areaUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${this.mapKey}/VIIRS_SNPP_NRT/22,44,40,52/1`;
          const res = await fetch(areaUrl, {
            headers: { "User-Agent": "EyeRadar/5.0 (Aviation Safety & Earth Observation)" },
            signal: AbortSignal.timeout(6000)
          });
          if (res.ok) {
            text = await res.text();
          }
        } catch {}
      }

      // Public open data fallback (no MAP_KEY required, official NASA Suomi-NPP VIIRS 24h Europe feed)
      if (!text || text.trim().length === 0) {
        const publicUrl = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_24h.csv";
        const res = await fetch(publicUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/csv,text/plain"
          },
          signal: AbortSignal.timeout(8000)
        });
        if (res.ok) {
          text = await res.text();
        }
      }

      if (!text) return [];

      const lines = text.trim().split("\n");
      const observations: Observation[] = [];

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",");
        if (parts.length < 3) continue;

        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        const bright = parseFloat(parts[2]);
        const dateStr = parts[5];
        const timeStr = parts[6];
        const confStr = parts[8]?.toLowerCase() || "";
        const frp = parseFloat(parts[11]) || 0;

        // Filter for intense thermal anomalies inside Ukraine
        if (lat >= 44.0 && lat <= 52.5 && lon >= 22.0 && lon <= 40.5 && bright >= 325) {
          let observedAt = now;
          try {
            if (dateStr && timeStr && dateStr.includes("-")) {
              const [y, m, d] = dateStr.split("-").map(Number);
              const hh = parseInt(timeStr.slice(0, 2), 10) || 0;
              const mm = parseInt(timeStr.slice(2, 4), 10) || 0;
              observedAt = Date.UTC(y, m - 1, d, hh, mm);
            }
          } catch {}

          const conf = confStr === "high" ? 0.95 : confStr === "nominal" ? 0.85 : 0.70;

          observations.push({
            id: `firms-${lat.toFixed(3)}-${lon.toFixed(3)}`,
            type: "thermal",
            lat,
            lon,
            heading: 0,
            speed: 0,
            timestamp: observedAt,
            source: "firms",
            confidence: conf,
            uncertaintyRadius: 2500,
            threatEvidence: [`satellite_viirs_thermal_${bright.toFixed(0)}K`],
            meta: {
              brightness: bright,
              frp,
              source_family: "thermal",
              source_id: "nasa-firms",
              observed_at: observedAt,
              model: `🔥 Теплова аномалія NASA (${bright.toFixed(0)}K)`
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
