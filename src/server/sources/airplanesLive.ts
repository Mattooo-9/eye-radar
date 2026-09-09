import type { Observation } from "../domain/types.js";

interface OpenSkyResponse {
  time: number;
  states: Array<[
    string,       // 0: icao24
    string | null,// 1: callsign
    string,       // 2: origin_country
    number | null,// 3: time_position
    number,       // 4: last_contact
    number | null,// 5: longitude
    number | null,// 6: latitude
    number | null,// 7: baro_altitude
    boolean,      // 8: on_ground
    number | null,// 9: velocity (m/s)
    number | null,// 10: true_track (deg)
    number | null,// 11: vertical_rate
    number[] | null,// 12: sensors
    number | null,// 13: geo_altitude
    string | null,// 14: squawk
    boolean,      // 15: spi
    number        // 16: position_source
  ]> | null;
}

export class AirplanesLiveSource {
  private lastFetch = 0;
  private cache: Observation[] = [];

  async fetchBorderFlights(): Promise<Observation[]> {
    const now = Date.now();
    // Cache for 10 seconds to respect rate limits
    if (now - this.lastFetch < 10_000 && this.cache.length > 0) {
      return this.cache;
    }

    // Try OpenSky Network first (Open public ADS-B over Ukraine theater: lat 44.0-52.5, lon 22.0-32.0)
    try {
      const openSkyUrl = "https://opensky-network.org/api/states/all?lamin=44.0&lomin=22.0&lamax=52.5&lomax=32.0";
      const res = await fetch(openSkyUrl, {
        headers: { "User-Agent": "EyeRadar/2.0 (Civil Air Safety; contact@eye-radar.ua)" },
        signal: AbortSignal.timeout(6000)
      });

      if (res.ok) {
        const data = (await res.json()) as OpenSkyResponse;
        const observations: Observation[] = [];

        for (const st of data.states ?? []) {
          const lon = st[5];
          const lat = st[6];
          const onGround = st[8];
          const velocity = st[9];
          const track = st[10];
          const alt = st[7];
          const callsign = (st[1] ?? "").trim();
          const hex = st[0];

          if (lat !== null && lon !== null && !onGround && velocity !== null && velocity > 25) {
            observations.push({
              id: `adsb-${hex}`,
              type: "aircraft",
              lat: Number(lat.toFixed(4)),
              lon: Number(lon.toFixed(4)),
              heading: track !== null ? Math.round(track) : 0,
              speed: Number(velocity.toFixed(1)),
              altitude: alt !== null ? Math.round(alt) : undefined,
              timestamp: now,
              source: "sdr",
              confidence: 0.95,
              meta: {
                callsign: callsign || hex,
                country: st[2]
              }
            });
          }
        }

        if (observations.length > 0) {
          this.cache = observations;
          this.lastFetch = now;
          return observations;
        }
      }
    } catch {
      // Fall through to fallback
    }

    this.lastFetch = now;
    return this.cache;
  }
}
