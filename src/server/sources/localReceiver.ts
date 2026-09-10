import { createUnifiedObservation, type UnifiedObservation } from "../domain/unifiedObservation.js";

interface Dump1090Aircraft {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  track?: number;
  speed?: number; // knots
  seen?: number;
  rssi?: number;
  messages?: number;
}

interface Dump1090AircraftJson {
  now: number;
  messages: number;
  aircraft: Dump1090Aircraft[];
}

export class LocalReceiverSource {
  private endpointUrl: string | null;

  constructor(endpointUrl?: string) {
    this.endpointUrl = endpointUrl || process.env.LOCAL_SDR_URL || null;
  }

  setEndpoint(url: string): void {
    this.endpointUrl = url;
  }

  async fetchLocalReceiverData(): Promise<UnifiedObservation[]> {
    if (!this.endpointUrl) {
      return [];
    }

    try {
      const res = await fetch(this.endpointUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(2000)
      });

      if (!res.ok) return [];

      const data = (await res.json()) as Dump1090AircraftJson;
      const now = Date.now();
      const observations: UnifiedObservation[] = [];

      for (const a of data.aircraft || []) {
        if (
          typeof a.lat === "number" &&
          typeof a.lon === "number" &&
          typeof a.speed === "number" &&
          a.speed > 15
        ) {
          const hex = a.hex.toLowerCase();
          const speedMs = a.speed * 0.514444;
          const altM = typeof a.alt_baro === "number" ? Math.round(a.alt_baro * 0.3048) : undefined;
          const flight = (a.flight ?? "").trim();

          observations.push(createUnifiedObservation({
            source_id: "local-receiver-dump1090",
            source_family: "radar",
            event_id: `local-${hex}-${now}`,
            object_id: flight ? `adsb-${flight}` : `adsb-${hex}`,
            observed_at: now - ((a.seen ?? 0) * 1000),
            lat: a.lat,
            lon: a.lon,
            speed: speedMs,
            heading: a.track !== undefined ? Math.round(a.track) : 0,
            altitude: altM,
            object_type: "aircraft",
            measurement_accuracy: 50, // Local SDR directly decoded
            source_quality: 0.98,
            confidence: 0.99,
            evidence: [
              `hex_${hex}`,
              `rssi_${a.rssi ?? -20}dBm`,
              `messages_${a.messages ?? 1}`
            ],
            provenance: "Local SDR (dump1090/readsb/tar1090)",
            callsign: flight || hex.toUpperCase(),
            model: "AIRCRAFT"
          }));
        }
      }

      return observations;
    } catch {
      return [];
    }
  }
}
