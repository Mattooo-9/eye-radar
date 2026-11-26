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

  async fetchFlightObservations(): Promise<UnifiedObservation[]> {
    const now = Date.now();
    if (now - this.lastFetch < 12_000 && this.cache.length > 0) {
      return this.cache;
    }

    const obsMap = new Map<string, UnifiedObservation>();

    const adsbEndpoints = [
      "https://api.adsb.lol/v2/point/50.0/22.0/250",
      "https://api.adsb.lol/v2/point/48.5/24.5/250",
      "https://api.adsb.lol/v2/point/44.5/26.0/250",
      "https://api.adsb.lol/v2/point/52.0/21.0/250",
      "https://api.adsb.lol/v2/point/46.5/29.0/250",
      "https://api.adsb.lol/v2/mil"
    ];

    await Promise.allSettled(
      adsbEndpoints.map(async (url) => {
        try {
          const res = await fetch(url, {
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
