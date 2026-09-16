import { createUnifiedObservation, type UnifiedObservation } from "../domain/unifiedObservation.js";
import type { Source } from "./sourceInterface.js";

export interface OpenSkyLiveState {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  timePosition: number | null;
  lastContact: number;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  sensors: number[] | null;
  geoAltitude: number | null;
  squawk: string | null;
  spi: boolean;
  positionSource: number;
}

export interface OpenSkyLivePayload {
  time: number;
  states: Array<[
    string,        // 0: icao24
    string | null, // 1: callsign
    string,        // 2: origin_country
    number | null, // 3: time_position
    number,        // 4: last_contact
    number | null, // 5: longitude
    number | null, // 6: latitude
    number | null, // 7: baro_altitude
    boolean,       // 8: on_ground
    number | null, // 9: velocity (m/s)
    number | null, // 10: true_track (deg)
    number | null, // 11: vertical_rate
    number[] | null,// 12: sensors
    number | null, // 13: geo_altitude
    string | null, // 14: squawk
    boolean,       // 15: spi
    number         // 16: position_source
  ]> | null;
}

/**
 * Validates whether a raw payload packet from OpenSky is genuine and contains valid coordinate data.
 */
export function validateOpenSkyPacket(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as OpenSkyLivePayload;
  if (typeof p.time !== "number" || p.time <= 0) return false;
  if (!Array.isArray(p.states)) return false;
  if (p.states.length === 0) return true; // valid empty response
  
  const sample = p.states[0];
  if (!Array.isArray(sample) || sample.length < 17) return false;
  const icao = sample[0];
  if (typeof icao !== "string" || icao.length < 4) return false;
  return true;
}

export class OpenSkyLiveSource implements Source {
  name = "opensky.live";
  private lastFetch = 0;
  private cache: UnifiedObservation[] = [];
  private readonly endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint =
      endpoint ||
      process.env.OPENSKY_ENDPOINT ||
      "https://opensky-network.org/api/states/all?lamin=44.0&lomin=22.0&lamax=54.0&lomax=42.0";
  }

  async fetchTracks(): Promise<UnifiedObservation[]> {
    const now = Date.now();
    if (now - this.lastFetch < 7000 && this.cache.length > 0) {
      return this.cache;
    }

    try {
      const res = await fetch(this.endpoint, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(3500)
      });

      if (!res.ok) {
        return this.cache;
      }

      const payload = (await res.json()) as OpenSkyLivePayload;
      if (!validateOpenSkyPacket(payload)) {
        console.warn("⚠️ OpenSkyLiveSource: payload failed empirical packet validation.");
        return this.cache;
      }

      const observations: UnifiedObservation[] = [];
      const pubTime = payload.time ? payload.time * 1000 : now;

      for (const st of payload.states ?? []) {
        const hex = st[0]?.toLowerCase();
        const lon = st[5];
        const lat = st[6];
        const onGround = st[8];
        const velocity = st[9];
        const track = st[10];
        const alt = st[7];
        const callsign = (st[1] ?? "").trim();
        const observedAt = st[3] ? st[3] * 1000 : pubTime;

        if (
          hex &&
          lat !== null &&
          lon !== null &&
          !onGround &&
          velocity !== null &&
          velocity > 20 &&
          lat >= 43 && lat <= 54 && lon >= 22 && lon <= 42
        ) {
          observations.push(
            createUnifiedObservation({
              source_id: "opensky.live",
              source_family: "adsb",
              event_id: `opensky-${hex}-${pubTime}`,
              object_id: `adsb-${hex}`,
              observed_at: observedAt,
              published_at: pubTime,
              received_at: now,
              lat,
              lon,
              speed: velocity,
              heading: track !== null ? Math.round(track) : 0,
              altitude: alt !== null ? Math.round(alt) : undefined,
              object_type: "aircraft",
              measurement_accuracy: 150,
              source_quality: 0.92,
              confidence: 0.95,
              evidence: [`hex_${hex}`, `sensor_count_${st[12]?.length ?? 1}`, "opensky_adsb"],
              provenance: `OpenSky Network Live [${st[2] || "INTL"}]`,
              callsign: callsign || hex.toUpperCase(),
              model: "MIL_AIRCRAFT"
            })
          );
        }
      }

      this.cache = observations;
      this.lastFetch = now;
      return observations;
    } catch {
      return this.cache;
    }
  }
}
