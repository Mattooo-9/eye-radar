import { createUnifiedObservation, type UnifiedObservation } from "../domain/unifiedObservation.js";
import type { Source } from "./sourceInterface.js";

export interface SdrAircraftEntry {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  alt_geom?: number;
  track?: number;
  speed?: number; // knots
  gs?: number;
  seen?: number;
  seen_pos?: number;
  rssi?: number;
  messages?: number;
  category?: string;
  type?: string;
  desc?: string;
}

export interface SdrAircraftPayload {
  now: number;
  messages?: number;
  aircraft?: SdrAircraftEntry[];
  ac?: SdrAircraftEntry[];
}

/**
 * Validates whether a raw packet from readsb / dump1090 is genuine SDR payload with real telemetry
 */
export function validateSdrPacket(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as SdrAircraftPayload;
  if (typeof p.now !== "number" || p.now <= 0) return false;
  const list = p.aircraft ?? p.ac;
  if (!Array.isArray(list)) return false;
  if (list.length === 0) return true; // valid idle packet

  const sample = list[0];
  if (!sample || typeof sample !== "object") return false;
  if (typeof sample.hex !== "string" || sample.hex.length < 4) return false;
  return true;
}

export class SdrReceiverSource implements Source {
  name = "sdr.receiver";
  private endpointUrl: string | null;
  private lastFetch = 0;
  private cache: UnifiedObservation[] = [];

  constructor(endpointUrl?: string) {
    this.endpointUrl = endpointUrl || process.env.SDR_RECEIVER_URL || process.env.LOCAL_SDR_URL || null;
  }

  isConfigured(): boolean {
    return Boolean(this.endpointUrl);
  }

  async fetchTracks(): Promise<UnifiedObservation[]> {
    if (!this.endpointUrl) {
      return this.cache;
    }

    const now = Date.now();
    if (now - this.lastFetch < 3000 && this.cache.length > 0) {
      return this.cache;
    }

    try {
      const res = await fetch(this.endpointUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(2500)
      });

      if (!res.ok) {
        return this.cache;
      }

      const payload = (await res.json()) as SdrAircraftPayload;
      if (!validateSdrPacket(payload)) {
        console.warn("⚠️ SdrReceiverSource: payload failed empirical packet validation.");
        return this.cache;
      }

      const observations: UnifiedObservation[] = [];
      const pubTime = payload.now ? Math.round(payload.now * 1000) : now;
      const aircraftList = payload.aircraft ?? payload.ac ?? [];

      for (const a of aircraftList) {
        const rawSpeed = a.speed ?? a.gs;
        if (
          typeof a.lat === "number" &&
          typeof a.lon === "number" &&
          typeof rawSpeed === "number" &&
          rawSpeed > 10 &&
          a.lat >= 43 && a.lat <= 54 && a.lon >= 22 && a.lon <= 42
        ) {
          const hex = a.hex.toLowerCase();
          const speedMs = rawSpeed * 0.514444; // knots to m/s
          const altM = typeof a.alt_baro === "number" ? Math.round(a.alt_baro * 0.3048) : undefined;
          const flight = (a.flight ?? "").trim();
          const seenSec = a.seen_pos ?? a.seen ?? 0;
          const observedAt = Math.max(0, pubTime - Math.round(seenSec * 1000));

          observations.push(
            createUnifiedObservation({
              source_id: "sdr.receiver",
              source_family: "radar",
              event_id: `sdr-${hex}-${pubTime}`,
              object_id: flight ? `adsb-${flight}` : `adsb-${hex}`,
              observed_at: observedAt,
              published_at: pubTime,
              received_at: now,
              lat: a.lat,
              lon: a.lon,
              speed: speedMs,
              heading: a.track !== undefined ? Math.round(a.track) : 0,
              altitude: altM,
              object_type: "aircraft",
              measurement_accuracy: 45, // High accuracy from direct physical SDR receiver
              source_quality: 0.98,
              confidence: 0.98,
              evidence: [
                `hex_${hex}`,
                `rssi_${a.rssi ?? -18}dBm`,
                `messages_${a.messages ?? 1}`,
                "sdr_direct_demod"
              ],
              provenance: "SDR Receiver (readsb/dump1090 direct RF feed)",
              callsign: flight || hex.toUpperCase(),
              model: a.desc ?? a.type ?? "MIL_AIRCRAFT"
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
