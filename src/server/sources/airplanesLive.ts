import type { Observation, TrackType } from "../domain/types.js";
import { isHelicopterAirframe, shouldIngestAdsbContact } from "./adsbClassifier.js";

interface AdsbFiAircraft {
  hex: string;
  type?: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  alt_baro?: number | "ground";
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

/**
 * Redundant military ADS-B aggregator (`adsb.fi` + `adsb.one`).
 * Distinct endpoint ownership from `adsb.lol` and `opensky.live` to prevent duplicate HTTP polling.
 */
export class AirplanesLiveSource {
  private lastFetch = 0;
  private cache: Observation[] = [];

  async fetchBorderFlights(): Promise<Observation[]> {
    const now = Date.now();
    if (now - this.lastFetch < 10_000 && this.cache.length > 0) {
      return this.cache;
    }

    const obsMap = new Map<string, Observation>();

    const adsbFiEndpoints = [
      "https://opendata.adsb.fi/api/v2/mil",
      "https://opendata.adsb.fi/api/v2/lat/48.8/lon/31.2/dist/250",
      "https://api.adsb.one/v2/mil",
      "https://api.adsb.one/v2/point/48.8/31.2/250"
    ];

    await Promise.allSettled(
      adsbFiEndpoints.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: {
              "User-Agent": "EyeRadar/2.0 (Civil Airspace Monitor)",
              Accept: "application/json"
            },
            signal: AbortSignal.timeout(7000)
          });
          if (!res.ok) return;

          const data = (await res.json()) as AdsbFiResponse;
          const aircraftList = data.aircraft ?? data.ac ?? [];
          for (const a of aircraftList) {
            if (a.lat === undefined || a.lon === undefined || a.gs === undefined || a.gs <= 25) {
              continue;
            }
            if (a.lat < 41.0 || a.lat > 56.0 || a.lon < 17.0 || a.lon > 43.0) {
              continue;
            }

            const flightCode = (a.flight ?? "").trim().replace(/\s+/g, "");
            const callsign = flightCode || a.t || a.hex;
            const gate = shouldIngestAdsbContact(a.lat, a.lon, callsign, a.desc, a.t);
            if (!gate.allowed) continue;

            const id = flightCode ? `adsb-${flightCode}` : `adsb-${a.hex}`;
            const rawModel = a.desc ?? a.t;
            const model = rawModel ?? (gate.isMil ? "Військовий борт (ADS-B)" : "Повітряне судно (ADS-B)");
            const speedMs = a.gs * 0.514444;
            const altM = typeof a.alt_baro === "number" ? Math.round(a.alt_baro * 0.3048) : undefined;
            const type: TrackType = isHelicopterAirframe(a.desc, a.t) ? "helicopter" : "aircraft";

            obsMap.set(a.hex, {
              id,
              type,
              lat: Number(a.lat.toFixed(4)),
              lon: Number(a.lon.toFixed(4)),
              heading: typeof a.track === "number" ? Math.round(a.track) : undefined,
              speed: Number(speedMs.toFixed(1)),
              altitude: altM,
              timestamp: now,
              source: "airplanes.live",
              confidence: 0.95,
              meta: {
                source_id: "airplanes.live",
                callsign: callsign || a.hex,
                model,
                squawk: a.squawk ?? "none",
                provenance: url.includes("adsb.one")
                  ? "ADSB.one · Військовий транспондер"
                  : "ADSB.fi · Військовий транспондер"
              }
            });
          }
        } catch {
          // Graceful degradation
        }
      })
    );

    this.cache = Array.from(obsMap.values());
    this.lastFetch = now;
    return this.cache;
  }
}
