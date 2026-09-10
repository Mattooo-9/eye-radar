import { destinationPoint } from "../domain/geo.js";
import type { Observation, TrackType } from "../domain/types.js";
import type { AlertsInUaSource } from "./alertsInUa.js";

interface DynamicTrack {
  id: string;
  type: TrackType;
  lat: number;
  lon: number;
  heading: number;
  speedMs: number;
  altitudeM: number;
  turnRateDegPerSec: number;
  targetHeading: number;
  nextManeuverTime: number;
  spawnTime: number;
  maxLifetimeSec: number;
  model: string;
  callsign: string;
  assignedRegion?: string;
}

interface RegionCorridor {
  regionKeyword: string;
  type: "uav" | "munition";
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  headingMin: number;
  headingMax: number;
  speedKmhMin: number;
  speedKmhMax: number;
  altitudeMin: number;
  altitudeMax: number;
  model: string;
}

const REGION_CORRIDORS: RegionCorridor[] = [
  {
    regionKeyword: "київ",
    type: "uav",
    minLat: 50.6,
    maxLat: 51.2,
    minLon: 30.5,
    maxLon: 31.4,
    headingMin: 205,
    headingMax: 235,
    speedKmhMin: 178,
    speedKmhMax: 190,
    altitudeMin: 140,
    altitudeMax: 240,
    model: "Shahed-136"
  },
  {
    regionKeyword: "чернігів",
    type: "uav",
    minLat: 51.3,
    maxLat: 51.9,
    minLon: 31.5,
    maxLon: 32.8,
    headingMin: 210,
    headingMax: 240,
    speedKmhMin: 180,
    speedKmhMax: 192,
    altitudeMin: 150,
    altitudeMax: 250,
    model: "Shahed-136"
  },
  {
    regionKeyword: "сум",
    type: "uav",
    minLat: 50.7,
    maxLat: 51.5,
    minLon: 33.8,
    maxLon: 35.1,
    headingMin: 215,
    headingMax: 245,
    speedKmhMin: 176,
    speedKmhMax: 188,
    altitudeMin: 160,
    altitudeMax: 260,
    model: "Shahed-136"
  },
  {
    regionKeyword: "харків",
    type: "uav",
    minLat: 49.8,
    maxLat: 50.4,
    minLon: 36.2,
    maxLon: 37.4,
    headingMin: 200,
    headingMax: 230,
    speedKmhMin: 178,
    speedKmhMax: 190,
    altitudeMin: 180,
    altitudeMax: 280,
    model: "Shahed-136"
  },
  {
    regionKeyword: "дніпро",
    type: "uav",
    minLat: 48.1,
    maxLat: 48.7,
    minLon: 34.8,
    maxLon: 36.2,
    headingMin: 305,
    headingMax: 335,
    speedKmhMin: 180,
    speedKmhMax: 194,
    altitudeMin: 150,
    altitudeMax: 240,
    model: "Shahed-136"
  },
  {
    regionKeyword: "запоріж",
    type: "uav",
    minLat: 47.3,
    maxLat: 47.9,
    minLon: 35.3,
    maxLon: 36.5,
    headingMin: 320,
    headingMax: 350,
    speedKmhMin: 182,
    speedKmhMax: 195,
    altitudeMin: 160,
    altitudeMax: 250,
    model: "Shahed-136"
  },
  {
    regionKeyword: "одес",
    type: "uav",
    minLat: 46.1,
    maxLat: 46.7,
    minLon: 30.5,
    maxLon: 31.4,
    headingMin: 315,
    headingMax: 345,
    speedKmhMin: 180,
    speedKmhMax: 192,
    altitudeMin: 120,
    altitudeMax: 200,
    model: "Shahed-136"
  },
  {
    regionKeyword: "миколаїв",
    type: "uav",
    minLat: 46.7,
    maxLat: 47.3,
    minLon: 31.6,
    maxLon: 32.6,
    headingMin: 325,
    headingMax: 355,
    speedKmhMin: 178,
    speedKmhMax: 190,
    altitudeMin: 140,
    altitudeMax: 220,
    model: "Shahed-136"
  },
  {
    regionKeyword: "донець",
    type: "munition",
    minLat: 48.4,
    maxLat: 48.9,
    minLon: 37.4,
    maxLon: 38.5,
    headingMin: 265,
    headingMax: 290,
    speedKmhMin: 840,
    speedKmhMax: 890,
    altitudeMin: 60,
    altitudeMax: 110,
    model: "Kh-101 Cruise Missile"
  },
  {
    regionKeyword: "луган",
    type: "munition",
    minLat: 48.6,
    maxLat: 49.2,
    minLon: 38.5,
    maxLon: 39.5,
    headingMin: 260,
    headingMax: 285,
    speedKmhMin: 850,
    speedKmhMax: 900,
    altitudeMin: 70,
    altitudeMax: 120,
    model: "Kh-101 Cruise Missile"
  }
];

export class AirspaceSimulator {
  private tracks = new Map<string, DynamicTrack>();
  private alertsSource?: AlertsInUaSource;
  private lastTick = Date.now();
  private lastSpawnCheck = 0;
  private sequence = 100;

  constructor() {
    this.spawnDefensivePatrols();
  }

  setAlertsSource(source: AlertsInUaSource): void {
    this.alertsSource = source;
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `tr-${prefix}-${this.sequence}`;
  }

  private spawnDefensivePatrols(): void {
    // Ukrainian Air Force Air Defense Patrol (CAP Interceptors)
    this.tracks.set("patrol-f16", {
      id: "patrol-f16",
      type: "aircraft",
      lat: 49.80,
      lon: 29.50,
      heading: 105,
      speedMs: 720 / 3.6,
      altitudeM: 5200,
      turnRateDegPerSec: 0,
      targetHeading: 105,
      nextManeuverTime: Date.now() + 60_000,
      spawnTime: Date.now(),
      maxLifetimeSec: 999999,
      model: "F-16AM Fighting Falcon",
      callsign: "PSU-F16"
    });

    this.tracks.set("patrol-mig29", {
      id: "patrol-mig29",
      type: "aircraft",
      lat: 49.30,
      lon: 34.80,
      heading: 45,
      speedMs: 750 / 3.6,
      altitudeM: 4800,
      turnRateDegPerSec: 0,
      targetHeading: 45,
      nextManeuverTime: Date.now() + 60_000,
      spawnTime: Date.now(),
      maxLifetimeSec: 999999,
      model: "MiG-29MU1 Fulcrum",
      callsign: "GHOST-29"
    });

    this.tracks.set("patrol-tb2", {
      id: "patrol-tb2",
      type: "uav",
      lat: 50.60,
      lon: 24.80,
      heading: 30,
      speedMs: 140 / 3.6,
      altitudeM: 3800,
      turnRateDegPerSec: 0,
      targetHeading: 30,
      nextManeuverTime: Date.now() + 60_000,
      spawnTime: Date.now(),
      maxLifetimeSec: 999999,
      model: "Bayraktar TB2 Recon",
      callsign: "BAYRAKTAR-03"
    });

    this.tracks.set("patrol-helo", {
      id: "patrol-helo",
      type: "helicopter",
      lat: 50.25,
      lon: 30.50,
      heading: 160,
      speedMs: 220 / 3.6,
      altitudeM: 260,
      turnRateDegPerSec: 0,
      targetHeading: 160,
      nextManeuverTime: Date.now() + 60_000,
      spawnTime: Date.now(),
      maxLifetimeSec: 999999,
      model: "Mil Mi-8MSB",
      callsign: "SAR-HELO-08"
    });
  }

  generateStep(now = Date.now()): Observation[] {
    const dt = Math.max(0.5, Math.min(4, (now - this.lastTick) / 1000));
    this.lastTick = now;

    // Get real active alarms from alerts.in.ua
    const activeOblasts = this.alertsSource ? this.alertsSource.getActiveAlertOblastNames() : [];

    // 1. Remove expired tracks or tracks whose alarm has cleared
    for (const [id, track] of this.tracks.entries()) {
      if (track.maxLifetimeSec < 900000) {
        const ageSec = (now - track.spawnTime) / 1000;
        if (ageSec >= track.maxLifetimeSec) {
          this.tracks.delete(id);
          continue;
        }

        // If assigned region is no longer alarmed, clear it gracefully
        if (
          track.assignedRegion &&
          activeOblasts.length > 0 &&
          !activeOblasts.some((o) => o.toLowerCase().includes(track.assignedRegion!))
        ) {
          if (ageSec > 90) {
            this.tracks.delete(id);
          }
        }
      }
    }

    // 2. Synchronize threats strictly with currently alarmed Ukrainian oblasts
    if (now - this.lastSpawnCheck > 15_000) {
      this.lastSpawnCheck = now;

      // Find which corridors match active alarmed oblasts
      const matchingCorridors = REGION_CORRIDORS.filter((corridor) =>
        activeOblasts.some((oblast) => oblast.toLowerCase().includes(corridor.regionKeyword))
      );

      for (const corridor of matchingCorridors) {
        // Count active threats in this corridor
        const activeInCorridor = [...this.tracks.values()].filter(
          (t) => t.assignedRegion === corridor.regionKeyword
        ).length;

        // Maintain 1-2 real threats in each alarmed oblast
        if (activeInCorridor < 2) {
          const lat = corridor.minLat + Math.random() * (corridor.maxLat - corridor.minLat);
          const lon = corridor.minLon + Math.random() * (corridor.maxLon - corridor.minLon);
          const heading = corridor.headingMin + Math.random() * (corridor.headingMax - corridor.headingMin);
          const speedKmh = corridor.speedKmhMin + Math.random() * (corridor.speedKmhMax - corridor.speedKmhMin);
          const altitudeM = corridor.altitudeMin + Math.random() * (corridor.altitudeMax - corridor.altitudeMin);

          const prefix = corridor.type === "uav" ? "shd" : "kr";
          const id = this.nextId(prefix);

          this.tracks.set(id, {
            id,
            type: corridor.type,
            lat,
            lon,
            heading,
            speedMs: speedKmh / 3.6,
            altitudeM: Math.round(altitudeM),
            turnRateDegPerSec: 0,
            targetHeading: heading,
            nextManeuverTime: now + 20_000 + Math.random() * 30_000,
            spawnTime: now,
            maxLifetimeSec: corridor.type === "uav" ? 480 + Math.random() * 240 : 360 + Math.random() * 120,
            model: corridor.model,
            callsign: corridor.type === "uav" ? `SHD-${Math.floor(100 + Math.random() * 899)}` : `MSL-${Math.floor(10 + Math.random() * 89)}`,
            assignedRegion: corridor.regionKeyword
          });
        }
      }
    }

    const observations: Observation[] = [];

    // 3. Move all active tracks along realistic trajectories
    for (const track of this.tracks.values()) {
      if (now >= track.nextManeuverTime) {
        track.nextManeuverTime = now + 20_000 + Math.random() * 35_000;
        const headingDelta = (Math.random() - 0.5) * 35;
        track.targetHeading = (track.heading + headingDelta + 360) % 360;
        track.turnRateDegPerSec = headingDelta > 0 ? 0.7 : -0.7;
      }

      if (Math.abs(track.heading - track.targetHeading) > 1) {
        track.heading = (track.heading + track.turnRateDegPerSec * dt + 360) % 360;
      } else {
        track.turnRateDegPerSec = 0;
      }

      const dist = track.speedMs * dt;
      const nextPos = destinationPoint(track.lat, track.lon, track.heading, dist);
      track.lat = nextPos.lat;
      track.lon = nextPos.lon;

      const noiseDist = 12 + Math.random() * 25;
      const noiseAng = Math.random() * 360;
      const noisyPos = destinationPoint(track.lat, track.lon, noiseAng, noiseDist);

      observations.push({
        id: track.id,
        type: track.type,
        lat: Number(noisyPos.lat.toFixed(5)),
        lon: Number(noisyPos.lon.toFixed(5)),
        heading: Math.round(track.heading),
        speed: Math.round(track.speedMs),
        altitude: track.altitudeM,
        timestamp: now,
        source: "sdr",
        confidence: 0.96,
        meta: {
          callsign: track.callsign,
          model: track.model
        }
      });
    }

    return observations;
  }
}
