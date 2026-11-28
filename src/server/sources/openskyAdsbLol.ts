import { createUnifiedObservation, type UnifiedObservation } from "../domain/unifiedObservation.js";
import type { TrackType } from "../domain/types.js";
import { isHelicopterAirframe, shouldIngestAdsbContact } from "./adsbClassifier.js";

interface AdsbAircraft {
  hex: string;
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
  seen?: number;
  seen_pos?: number;
  mlat?: string[];
  tisb?: string[];
  nac_p?: number;
  sil?: number;
}

interface AdsbResponse {
  aircraft?: AdsbAircraft[];
  ac?: AdsbAircraft[];
  total?: number;
}

/**
 * Dedicated adsb.lol transponder feed adapter.
 * Owns adsb.lol endpoints exclusively (no duplicate polling of adsb.fi/opensky).
 */
export class OpenskyAdsbLolSource {
  private lastFetch = 0;
  private cache: UnifiedObservation[] = [];
  private endpointIdx = 0;

  async fetchFlightObservations(): Promise<UnifiedObservation[]> {
    const now = Date.now();
    if (now - this.lastFetch < 16_000 && this.cache.length > 0) {
      return this.cache;
    }

    const obsMap = new Map<string, UnifiedObservation>();
    for (const c of this.cache) {
      if (c.object_id && c.observed_at && now - c.observed_at < 35_000) {
        obsMap.set(c.object_id, c);
      }
    }

    // Rotate 1 single endpoint per poll cycle to avoid adsb.lol HTTP 429 rate-limiting
    const adsbEndpoints = [
      "https://api.adsb.lol/v2/point/48.8/31.2/250",
      "https://api.adsb.lol/v2/mil",
      "https://api.adsb.lol/v2/point/49.5/25.5/250"
    ];
    const url = adsbEndpoints[this.endpointIdx % adsbEndpoints.length];
    this.endpointIdx += 1;

    await Promise.allSettled(
      [url].map(async (epUrl) => {
        try {
          const res = await fetch(epUrl, {
            headers: {
              "User-Agent": "EyeRadar/2.0 (Civil Airspace Monitor)",
              Accept: "application/json"
            },
            signal: AbortSignal.timeout(4500)
          });
          if (!res.ok) return;

          const data = (await res.json()) as AdsbResponse;
          const aircraftList = data.aircraft ?? data.ac ?? [];
          for (const a of aircraftList) {
            if (
              typeof a.lat !== "number" ||
              typeof a.lon !== "number" ||
              typeof a.gs !== "number" ||
              a.gs <= 20
            ) {
              continue;
            }
            if (a.lat < 41.0 || a.lat > 56.0 || a.lon < 17.0 || a.lon > 43.0) {
              continue;
            }

            const hex = a.hex.toLowerCase();
            const flight = (a.flight ?? "").trim().replace(/\s+/g, "");
            const callsign = flight || a.t || a.hex.toUpperCase();
            const gate = shouldIngestAdsbContact(a.lat, a.lon, callsign, a.desc, a.t);
            if (!gate.allowed) continue;

            const speedMs = a.gs * 0.514444;
            const objType: TrackType = isHelicopterAirframe(a.desc, a.t) ? "helicopter" : "aircraft";
            const altM = typeof a.alt_baro === "number" ? Math.round(a.alt_baro * 0.3048) : undefined;
            const accuracy = a.nac_p && a.nac_p >= 9 ? 30 : a.nac_p && a.nac_p >= 7 ? 100 : 350;

            obsMap.set(
              hex,
              createUnifiedObservation({
                source_id: "adsb.lol",
                source_family: "adsb",
                event_id: `adsb-${hex}-${now}`,
                object_id: flight ? `adsb-${flight}` : `adsb-${hex}`,
                observed_at: now - (a.seen_pos ?? 0) * 1000,
                lat: a.lat,
                lon: a.lon,
                speed: speedMs,
                heading: typeof a.track === "number" ? Math.round(a.track) : undefined,
                altitude: altM,
                object_type: objType,
                measurement_accuracy: accuracy,
                source_quality: 0.95,
                confidence: 0.96,
                evidence: [
                  `hex_${hex}`,
                  `squawk_${a.squawk || "none"}`,
                  a.mlat ? "mlat_triangulated" : "direct_adsb"
                ],
                provenance: gate.isMil
                  ? "ADS-B.lol · Військовий / державний транспондер"
                  : "ADS-B.lol · Транспондер у просторі України",
                model: a.desc ?? a.t ?? (gate.isMil ? "Військовий борт (ADS-B)" : "Повітряне судно (ADS-B)"),
                callsign
              })
            );
          }
        } catch {
          // Graceful degradation on single endpoint timeout
        }
      })
    );

    this.cache = Array.from(obsMap.values());
    this.lastFetch = now;
    return this.cache;
  }
}
