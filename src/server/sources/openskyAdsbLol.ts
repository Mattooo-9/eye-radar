import { createUnifiedObservation, type UnifiedObservation } from "../domain/unifiedObservation.js";
import type { TrackType } from "../domain/types.js";

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

interface OpenSkyStateResponse {
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

export class OpenskyAdsbLolSource {
  private lastFetch = 0;
  private cache: UnifiedObservation[] = [];

  private isHelicopter(desc?: string, model?: string): boolean {
    const text = `${desc ?? ""} ${model ?? ""}`.toUpperCase();
    return (
      text.includes("HELICOPTER") ||
      text.includes("ROTORCRAFT") ||
      text.includes("BELL ") ||
      text.includes("SIKORSKY") ||
      text.includes("EUROCOPTER") ||
      text.includes("EC1") ||
      text.includes("H125") ||
      text.includes("H145") ||
      text.includes("MI-8") ||
      text.includes("MI-2") ||
      text.includes("R44") ||
      text.includes("R66")
    );
  }

  async fetchFlightObservations(): Promise<UnifiedObservation[]> {
    const now = Date.now();
    // Cache for 6 seconds to respect rate limits
    if (now - this.lastFetch < 6_000 && this.cache.length > 0) {
      return this.cache;
    }

    const obsMap = new Map<string, UnifiedObservation>();

    // 1. Fetch from ADSB.lol public feeds
    const adsbEndpoints = [
      "https://api.adsb.lol/v2/mil",
      "https://api.adsb.lol/v2/point/50.0/24.5/250", // West UA border / Poland
      "https://api.adsb.lol/v2/point/46.5/28.5/250", // South UA / Romania / Black Sea
      "https://opendata.adsb.fi/api/v2/mil"
    ];

    await Promise.allSettled(
      adsbEndpoints.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "EyeRadar/3.5 (Civil Defense Situational Awareness; contact@eye-radar.ua)" },
            signal: AbortSignal.timeout(4000)
          });
          if (res.ok) {
            const data = (await res.json()) as AdsbResponse;
            const aircraftList = data.aircraft ?? data.ac ?? [];
            for (const a of aircraftList) {
              if (
                typeof a.lat === "number" &&
                typeof a.lon === "number" &&
                typeof a.gs === "number" &&
                a.gs > 20
              ) {
                // Geo-boundary filter: Eastern European / Black Sea theater
                if (a.lat < 42 || a.lat > 56 || a.lon < 20 || a.lon > 42) {
                  continue;
                }

                const hex = a.hex.toLowerCase();
                const flight = (a.flight ?? "").trim().replace(/\s+/g, "");
                const callsign = flight || a.t || a.hex.toUpperCase();
                const speedMs = a.gs * 0.514444; // knots to m/s
                const isHeli = this.isHelicopter(a.desc, a.t);
                const objType: TrackType = isHeli ? "helicopter" : "aircraft";
                const altM = typeof a.alt_baro === "number" ? Math.round(a.alt_baro * 0.3048) : undefined;
                const accuracy = a.nac_p && a.nac_p >= 9 ? 30 : a.nac_p && a.nac_p >= 7 ? 100 : 350;

                const evidence = [
                  `hex_${hex}`,
                  `squawk_${a.squawk || "none"}`,
                  a.mlat ? "mlat_triangulated" : "direct_adsb"
                ];

                obsMap.set(hex, createUnifiedObservation({
                  source_id: "adsb-lol",
                  source_family: "adsb",
                  event_id: `adsb-${hex}-${now}`,
                  object_id: flight ? `adsb-${flight}` : `adsb-${hex}`,
                  observed_at: now - ((a.seen_pos ?? 0) * 1000),
                  lat: a.lat,
                  lon: a.lon,
                  speed: speedMs,
                  heading: a.track ? Math.round(a.track) : 0,
                  altitude: altM,
                  object_type: objType,
                  measurement_accuracy: accuracy,
                  source_quality: 0.95,
                  confidence: 0.96,
                  evidence,
                  provenance: url.includes("/mil") ? "Military transponder feed" : "Border corridor ADS-B",
                  model: a.desc ?? a.t ?? (url.includes("/mil") ? "MIL_AIRCRAFT" : "CIVIL_AIRCRAFT"),
                  callsign
                }));
              }
            }
          }
        } catch {
          // Endpoint failure is tolerated
        }
      })
    );

    // 2. OpenSky fallback if ADSB coverage is low
    if (obsMap.size < 15) {
      try {
        const openSkyUrl = "https://opensky-network.org/api/states/all?lamin=44.0&lomin=22.0&lamax=52.5&lomax=32.0";
        const res = await fetch(openSkyUrl, {
          headers: { "User-Agent": "EyeRadar/3.5 (Civil Defense Awareness; contact@eye-radar.ua)" },
          signal: AbortSignal.timeout(4500)
        });
        if (res.ok) {
          const data = (await res.json()) as OpenSkyStateResponse;
          for (const st of data.states ?? []) {
            const hex = st[0]?.toLowerCase();
            const lon = st[5];
            const lat = st[6];
            const onGround = st[8];
            const velocity = st[9];
            const track = st[10];
            const alt = st[7];
            const callsign = (st[1] ?? "").trim();

            if (hex && !obsMap.has(hex) && lat !== null && lon !== null && !onGround && velocity !== null && velocity > 20) {
              obsMap.set(hex, createUnifiedObservation({
                source_id: "opensky-network",
                source_family: "adsb",
                event_id: `opensky-${hex}-${now}`,
                object_id: `adsb-${hex}`,
                observed_at: st[3] ? st[3] * 1000 : now,
                lat,
                lon,
                speed: velocity,
                heading: track !== null ? Math.round(track) : 0,
                altitude: alt !== null ? Math.round(alt) : undefined,
                object_type: "aircraft",
                measurement_accuracy: 250,
                source_quality: 0.9,
                confidence: 0.94,
                evidence: [`hex_${hex}`, `opensky_sensor_count_${st[12]?.length ?? 1}`],
                provenance: `OpenSky (${st[2] || "International"})`,
                callsign: callsign || hex.toUpperCase(),
                model: "AIRCRAFT"
              }));
            }
          }
        }
      } catch {
        // OpenSky rate limit / timeout tolerated
      }
    }

    this.cache = Array.from(obsMap.values());
    this.lastFetch = now;
    return this.cache;
  }
}
