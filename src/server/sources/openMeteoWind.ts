export interface WindSample {
  city: string;
  speedKmh: number;
  directionDeg: number;
  timestamp: number;
}

export class OpenMeteoWindSource {
  private lastFetch = 0;
  private cache = new Map<string, WindSample>();

  async fetchWind(): Promise<WindSample[]> {
    const now = Date.now();
    // Cache for 10 minutes
    if (now - this.lastFetch < 600_000 && this.cache.size > 0) {
      return [...this.cache.values()];
    }

    try {
      // Fetch for Central Ukraine (around Cherkasy / Kyiv)
      const res = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=49.44&longitude=32.06&current=wind_speed_10m,wind_direction_10m",
        { signal: AbortSignal.timeout(6000) }
      );

      if (res.ok) {
        const data = (await res.json()) as { current?: { wind_speed_10m: number; wind_direction_10m: number } };
        if (data.current) {
          const sample: WindSample = {
            city: "Central Ukraine",
            speedKmh: data.current.wind_speed_10m,
            directionDeg: data.current.wind_direction_10m,
            timestamp: now
          };
          this.cache.set("central", sample);
          this.lastFetch = now;
          return [sample];
        }
      }
    } catch {
      // Graceful fallback
    }

    // Default seasonal wind
    const fallback: WindSample = {
      city: "Central Ukraine",
      speedKmh: 18,
      directionDeg: 270, // Westerly
      timestamp: now
    };
    return [fallback];
  }
}
