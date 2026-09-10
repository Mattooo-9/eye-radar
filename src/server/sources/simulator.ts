import { destinationPoint } from "../domain/geo.js";
import type { Observation, TrackType } from "../domain/types.js";
import type { AlertsInUaSource } from "./alertsInUa.js";
import { impactManager } from "../core/impactManager.js";

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

function formatOblastTitle(keyword?: string): string {
  if (!keyword) return "Україна";
  const map: Record<string, string> = {
    "київ": "Київська область",
    "чернігів": "Чернігівська область",
    "сум": "Сумська область",
    "харків": "Харківська область",
    "дніпро": "Дніпропетровська область",
    "запоріж": "Запорізька область",
    "донець": "Донецька область",
    "луган": "Луганська область",
    "полтав": "Полтавська область",
    "черкас": "Черкаська область",
    "кіровоград": "Кіровоградська область",
    "одес": "Одеська область",
    "миколаїв": "Миколаївська область",
    "херсон": "Херсонська область",
    "вінниць": "Вінницька область",
    "житомир": "Житомирська область",
    "хмельницьк": "Хмельницька область",
    "рівнен": "Рівненська область",
    "волин": "Волинська область",
    "львів": "Львівська область"
  };
  return map[keyword] || `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} область`;
}

const REGION_CORRIDORS: RegionCorridor[] = [
  {
    regionKeyword: "київ",
    type: "uav",
    minLat: 50.5,
    maxLat: 51.1,
    minLon: 30.3,
    maxLon: 31.2,
    headingMin: 210,
    headingMax: 240,
    speedKmhMin: 180,
    speedKmhMax: 192,
    altitudeMin: 140,
    altitudeMax: 220,
    model: "Shahed-136"
  },
  {
    regionKeyword: "київ",
    type: "uav",
    minLat: 50.8,
    maxLat: 51.3,
    minLon: 30.6,
    maxLon: 31.4,
    headingMin: 215,
    headingMax: 245,
    speedKmhMin: 490,
    speedKmhMax: 530,
    altitudeMin: 350,
    altitudeMax: 500,
    model: "Shahed-238 (Jet)"
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
    speedKmhMin: 100,
    speedKmhMax: 120,
    altitudeMin: 1400,
    altitudeMax: 2200,
    model: "Supercam S350 Recon"
  },
  {
    regionKeyword: "сум",
    type: "uav",
    minLat: 50.8,
    maxLat: 51.6,
    minLon: 34.0,
    maxLon: 35.0,
    headingMin: 220,
    headingMax: 250,
    speedKmhMin: 178,
    speedKmhMax: 190,
    altitudeMin: 150,
    altitudeMax: 240,
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
    altitudeMin: 160,
    altitudeMax: 250,
    model: "Shahed-136"
  },
  {
    regionKeyword: "харків",
    type: "munition",
    minLat: 50.0,
    maxLat: 50.3,
    minLon: 36.5,
    maxLon: 37.2,
    headingMin: 210,
    headingMax: 235,
    speedKmhMin: 850,
    speedKmhMax: 890,
    altitudeMin: 60,
    altitudeMax: 120,
    model: "Kh-101 Cruise Missile"
  },
  {
    regionKeyword: "дніпро",
    type: "uav",
    minLat: 48.2,
    maxLat: 48.7,
    minLon: 34.8,
    maxLon: 36.0,
    headingMin: 310,
    headingMax: 340,
    speedKmhMin: 180,
    speedKmhMax: 194,
    altitudeMin: 150,
    altitudeMax: 240,
    model: "Shahed-136"
  },
  {
    regionKeyword: "запоріж",
    type: "uav",
    minLat: 47.4,
    maxLat: 47.9,
    minLon: 35.3,
    maxLon: 36.4,
    headingMin: 320,
    headingMax: 350,
    speedKmhMin: 95,
    speedKmhMax: 115,
    altitudeMin: 1500,
    altitudeMax: 2400,
    model: "Orlan-10 Recon"
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
    regionKeyword: "полтав",
    type: "uav",
    minLat: 49.3,
    maxLat: 49.9,
    minLon: 34.2,
    maxLon: 35.1,
    headingMin: 225,
    headingMax: 255,
    speedKmhMin: 180,
    speedKmhMax: 192,
    altitudeMin: 150,
    altitudeMax: 230,
    model: "Shahed-136"
  },
  {
    regionKeyword: "черкас",
    type: "uav",
    minLat: 49.1,
    maxLat: 49.7,
    minLon: 31.8,
    maxLon: 32.6,
    headingMin: 250,
    headingMax: 280,
    speedKmhMin: 180,
    speedKmhMax: 195,
    altitudeMin: 160,
    altitudeMax: 240,
    model: "Shahed-136"
  },
  {
    regionKeyword: "кіровоград",
    type: "uav",
    minLat: 48.3,
    maxLat: 48.8,
    minLon: 31.9,
    maxLon: 32.6,
    headingMin: 280,
    headingMax: 310,
    speedKmhMin: 178,
    speedKmhMax: 190,
    altitudeMin: 140,
    altitudeMax: 220,
    model: "Shahed-136"
  },
  {
    regionKeyword: "одес",
    type: "uav",
    minLat: 46.2,
    maxLat: 46.8,
    minLon: 30.4,
    maxLon: 31.2,
    headingMin: 325,
    headingMax: 355,
    speedKmhMin: 182,
    speedKmhMax: 195,
    altitudeMin: 120,
    altitudeMax: 200,
    model: "Shahed-136"
  },
  {
    regionKeyword: "миколаїв",
    type: "uav",
    minLat: 46.8,
    maxLat: 47.3,
    minLon: 31.8,
    maxLon: 32.6,
    headingMin: 330,
    headingMax: 360,
    speedKmhMin: 180,
    speedKmhMax: 194,
    altitudeMin: 130,
    altitudeMax: 210,
    model: "Shahed-136"
  },
  {
    regionKeyword: "херсон",
    type: "uav",
    minLat: 46.5,
    maxLat: 47.0,
    minLon: 32.5,
    maxLon: 33.5,
    headingMin: 310,
    headingMax: 340,
    speedKmhMin: 178,
    speedKmhMax: 190,
    altitudeMin: 110,
    altitudeMax: 190,
    model: "Shahed-136"
  },
  {
    regionKeyword: "вінниць",
    type: "uav",
    minLat: 49.0,
    maxLat: 49.5,
    minLon: 28.2,
    maxLon: 29.0,
    headingMin: 270,
    headingMax: 300,
    speedKmhMin: 180,
    speedKmhMax: 192,
    altitudeMin: 170,
    altitudeMax: 250,
    model: "Shahed-136"
  },
  {
    regionKeyword: "житомир",
    type: "uav",
    minLat: 50.1,
    maxLat: 50.6,
    minLon: 28.5,
    maxLon: 29.2,
    headingMin: 250,
    headingMax: 275,
    speedKmhMin: 180,
    speedKmhMax: 192,
    altitudeMin: 150,
    altitudeMax: 230,
    model: "Shahed-136"
  },
  {
    regionKeyword: "хмельницьк",
    type: "munition",
    minLat: 49.3,
    maxLat: 49.8,
    minLon: 26.8,
    maxLon: 27.5,
    headingMin: 270,
    headingMax: 295,
    speedKmhMin: 860,
    speedKmhMax: 900,
    altitudeMin: 80,
    altitudeMax: 130,
    model: "Kh-101 Cruise Missile"
  },
  {
    regionKeyword: "рівнен",
    type: "uav",
    minLat: 50.5,
    maxLat: 51.0,
    minLon: 26.0,
    maxLon: 26.6,
    headingMin: 265,
    headingMax: 290,
    speedKmhMin: 180,
    speedKmhMax: 194,
    altitudeMin: 150,
    altitudeMax: 220,
    model: "Shahed-136"
  },
  {
    regionKeyword: "волин",
    type: "uav",
    minLat: 50.7,
    maxLat: 51.2,
    minLon: 25.1,
    maxLon: 25.7,
    headingMin: 270,
    headingMax: 300,
    speedKmhMin: 180,
    speedKmhMax: 192,
    altitudeMin: 160,
    altitudeMax: 240,
    model: "Shahed-136"
  },
  {
    regionKeyword: "львів",
    type: "munition",
    minLat: 49.7,
    maxLat: 50.1,
    minLon: 23.8,
    maxLon: 24.5,
    headingMin: 275,
    headingMax: 305,
    speedKmhMin: 870,
    speedKmhMax: 920,
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
    // Strictly live alert-correlated threats only; zero permanent hanging static dummy patrols
  }

  setAlertsSource(source: AlertsInUaSource): void {
    this.alertsSource = source;
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `tr-${prefix}-${this.sequence}`;
  }

  generateStep(now = Date.now()): Observation[] {
    const dt = Math.max(0.5, Math.min(4, (now - this.lastTick) / 1000));
    this.lastTick = now;

    // Get real active alarms from alerts.in.ua
    const activeOblasts = this.alertsSource ? this.alertsSource.getActiveAlertOblastNames() : [];

    // 1. Remove expired tracks (with impact/interception event) or tracks whose alarm has cleared
    for (const [id, track] of this.tracks.entries()) {
      if (track.maxLifetimeSec < 900000) {
        const ageSec = (now - track.spawnTime) / 1000;

        // If target reached terminal destination: record impact or interception & DELETE IMMEDIATELY
        if (ageSec >= track.maxLifetimeSec) {
          const isIntercept = Math.random() < 0.78;
          const regionName = formatOblastTitle(track.assignedRegion);
          impactManager.createAndRecord(
            isIntercept ? "intercept" : "impact",
            track.lat,
            track.lon,
            track.model,
            track.type,
            regionName,
            isIntercept
              ? `Успішне перехоплення мобільною вогневою групою / підрозділом ППО: ${track.model}`
              : `Зафіксовано влучання / детонацію боєприпасу: ${track.model}`
          );
          this.tracks.delete(id);
          continue;
        }

        // If assigned region is no longer alarmed or alarms cleared across Ukraine: DELETE IMMEDIATELY
        if (
          track.assignedRegion &&
          (activeOblasts.length === 0 || !activeOblasts.some((o) => o.toLowerCase().includes(track.assignedRegion!)))
        ) {
          this.tracks.delete(id);
          continue;
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
            maxLifetimeSec: corridor.type === "uav" ? 180 + Math.random() * 120 : 120 + Math.random() * 90,
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
