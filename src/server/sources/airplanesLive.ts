import type { Observation } from "../domain/types.js";

interface AirplanesLiveFlight {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  track?: number;
  gs?: number; // Ground speed in knots
  alt_baro?: number | string;
  seen?: number;
}

export class AirplanesLiveSource {
  private lastFetch = 0;
  private cache: Observation[] = [];

  async fetchBorderFlights(): Promise<Observation[]> {
    const now = Date.now();
    // Cache for 12 seconds to respect free public rate limits
    if (now - this.lastFetch < 12_000 && this.cache.length > 0) {
      return this.cache;
    }

    try {
      // Query Western border point (near Poland/Slovakia/Romania - lat 49.0, lon 23.5, radius 120 nm)
      const url = "https://api.airplanes.live/v2/point/49.0/23.5/120";
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });

      if (res.ok) {
        const data = (await res.json()) as { ac?: AirplanesLiveFlight[] };
        const observations: Observation[] = [];

        for (const ac of data.ac ?? []) {
          if (typeof ac.lat === "number" && typeof ac.lon === "number") {
            const speedMs = typeof ac.gs === "number" ? ac.gs * 0.514444 : 120;
            const altitudeM = typeof ac.alt_baro === "number" ? Math.round(ac.alt_baro * 0.3048) : undefined;
            const flightCode = ac.flight ? ac.flight.trim() : ac.hex;

            observations.push({
              id: `adsb-${ac.hex}`,
              type: "aircraft",
              lat: Number(ac.lat.toFixed(5)),
              lon: Number(ac.lon.toFixed(5)),
              heading: typeof ac.track === "number" ? ac.track : 0,
              speed: Number(speedMs.toFixed(1)),
              altitude: altitudeM,
              timestamp: now,
              source: "sdr",
              confidence: 0.95,
              meta: {
                flightCode,
                hex: ac.hex
              }
            });
          }
        }

        this.cache = observations;
        this.lastFetch = now;
        return observations;
      }
    } catch {
      // Graceful fallback to cached
    }

    this.lastFetch = now;
    return this.cache;
  }
}
