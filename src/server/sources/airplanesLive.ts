import type { Observation, TrackType } from "../domain/types.js";

interface AdsbFiAircraft {
  hex: string;
  type?: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  alt_baro?: number;
  alt_geom?: number;
  gs?: number;
  track?: number;
  lat?: number;
  lon?: number;
  category?: string;
  squawk?: string;
}

interface AdsbFiResponse {
  aircraft?: AdsbFiAircraft[];
  ac?: AdsbFiAircraft[];
  resultCount?: number;
  total?: number;
}

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

  private isHelicopter(desc?: string, model?: string): boolean {
    const text = `${desc ?? ""} ${model ?? ""}`.toUpperCase();
    return (
      text.includes("HELICOPTER") ||
      text.includes("ROTORCRAFT") ||
      text.includes("BELL ") ||
      text.includes("SIKORSKY") ||
      text.includes("EUROCOPTER") ||
      text.includes("EC1") ||
      text.includes("EC2") ||
      text.includes("H125") ||
      text.includes("H135") ||
      text.includes("H145") ||
      text.includes("MI-8") ||
      text.includes("MI-2") ||
      text.includes("R44") ||
      text.includes("R66")
    );
  }

  private isCivilAirliner(callsign?: string, desc?: string, model?: string): boolean {
    const text = `${callsign ?? ""} ${desc ?? ""} ${model ?? ""}`.toUpperCase();
    const civilPrefixes = [
      "RYR", "WZZ", "WUK", "LOT", "DLH", "KLM", "AFR", "BAW", "THY", "AUA",
      "SXS", "PGT", "EZY", "EZS", "SAS", "FIN", "BTI", "ENT", "TOM", "FDB",
      "ETH", "ROT", "CAI", "ISR", "PIA", "FDX", "UPS", "BOX", "CGF", "MNB",
      "UTN", "LBT", "NMA", "GJT", "ASL", "EXS", "CCA", "SIA", "RYS", "NSZ",
      "BOEING", "AIRBUS", "EMBRAER", "CRJ", "ATR", "B73", "B74", "B75", "B76", "B77", "B78",
      "A31", "A32", "A33", "A35", "A38", "A20N", "A21N", "B38M", "B39M", "CIVIL"
    ];
    return civilPrefixes.some((p) => text.includes(p));
  }

  async fetchBorderFlights(): Promise<Observation[]> {
    const now = Date.now();
    // Cache for 8 seconds to stay fresh while respecting public API rate limits
    if (now - this.lastFetch < 8_000 && this.cache.length > 0) {
      return this.cache;
    }

    const obsMap = new Map<string, Observation>();

    // 1. Fetch strictly from military feeds to exclude foreign civil passenger airways
    const adsbFiEndpoints = [
      "https://opendata.adsb.fi/api/v2/mil" // Regional Military & Reconnaissance Aircraft
    ];

    await Promise.allSettled(
      adsbFiEndpoints.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "EyeRadar/2.0 (Civil Aviation Safety; contact@eye-radar.ua)" },
            signal: AbortSignal.timeout(4500)
          });
          if (res.ok) {
            const data = (await res.json()) as AdsbFiResponse;
            const aircraftList = data.aircraft ?? data.ac ?? [];
            for (const a of aircraftList) {
              if (
                a.lat !== undefined &&
                a.lon !== undefined &&
                a.gs !== undefined &&
                a.gs > 25
              ) {
                // Bound to Eastern European / Ukrainian defense theater
                if (a.lat < 43 || a.lat > 54 || a.lon < 22 || a.lon > 42) {
                  continue;
                }

                const flightCode = (a.flight ?? "").trim().replace(/\s+/g, "");
                const callsign = flightCode || a.t || a.hex;

                // Eliminate civilian passenger airliners
                if (this.isCivilAirliner(callsign, a.desc, a.t)) {
                  continue;
                }

                const id = flightCode ? `adsb-${flightCode}` : `adsb-${a.hex}`;
                const model = a.desc ?? a.t ?? "MIL_AIRCRAFT";
                const speedMs = a.gs * 0.514444; // knots to m/s
                const altM = a.alt_baro ? Math.round(a.alt_baro * 0.3048) : undefined;
                const type: TrackType = this.isHelicopter(a.desc, a.t) ? "helicopter" : "aircraft";

                obsMap.set(a.hex, {
                  id,
                  type,
                  lat: Number(a.lat.toFixed(4)),
                  lon: Number(a.lon.toFixed(4)),
                  heading: a.track ? Math.round(a.track) : 0,
                  speed: Number(speedMs.toFixed(1)),
                  altitude: altM,
                  timestamp: now,
                  source: "sdr",
                  confidence: 0.95,
                  meta: {
                    callsign: callsign || a.hex,
                    model,
                    squawk: a.squawk ?? "none"
                  }
                });
              }
            }
          }
        } catch {
          // Continue with next endpoint
        }
      })
    );

    // 2. OpenSky fallback only for verified air activity inside Ukrainian airspace
    if (obsMap.size < 5) {
      try {
        const openSkyUrl =
          "https://opensky-network.org/api/states/all?lamin=45.0&lomin=24.0&lamax=52.0&lomax=38.0";
        const res = await fetch(openSkyUrl, {
          headers: { "User-Agent": "EyeRadar/2.0 (Civil Air Safety; contact@eye-radar.ua)" },
          signal: AbortSignal.timeout(5000)
        });

        if (res.ok) {
          const data = (await res.json()) as OpenSkyResponse;
          for (const st of data.states ?? []) {
            const hex = st[0];
            const lon = st[5];
            const lat = st[6];
            const onGround = st[8];
            const velocity = st[9];
            const track = st[10];
            const alt = st[7];
            const callsign = (st[1] ?? "").trim();

            if (
              !obsMap.has(hex) &&
              lat !== null &&
              lon !== null &&
              !onGround &&
              velocity !== null &&
              velocity > 25 &&
              !this.isCivilAirliner(callsign)
            ) {
              obsMap.set(hex, {
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
        }
      } catch {
        // Fallback
      }
    }

    if (obsMap.size > 0) {
      this.cache = Array.from(obsMap.values());
      this.lastFetch = now;
      return this.cache;
    }

    // If fetch returned no airborne contacts or failed, flush cache so ended flights prune immediately
    this.cache = [];
    this.lastFetch = now;
    return [];
  }
}
