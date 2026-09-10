import { destinationPoint } from "../domain/geo.js";
import type { Observation, TrackType } from "../domain/types.js";

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
}

export class AirspaceSimulator {
  private tracks = new Map<string, DynamicTrack>();
  private lastTick = Date.now();
  private lastSpawnTime = 0;
  private sequence = 100;

  constructor() {
    this.resetScenario();
  }

  resetScenario(): void {
    this.tracks.clear();
    this.lastSpawnTime = 0;
    this.spawnInitialWave();
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `tr-${prefix}-${this.sequence}`;
  }

  private spawnInitialWave(): void {
    const now = Date.now();

    // 1. Initial Shahed Group Southern Ingress (Sea of Azov / Berdyansk corridor towards Zaporizhzhia & Dnipro)
    this.spawnTrack({
      type: "uav",
      lat: 46.75 + (Math.random() - 0.5) * 0.4,
      lon: 36.20 + (Math.random() - 0.5) * 0.4,
      heading: 320 + Math.random() * 20,
      speedKmh: 178 + Math.random() * 15,
      altitudeM: 180 + Math.random() * 80,
      model: "Shahed-136",
      callsign: `SHAHED-${Math.floor(200 + Math.random() * 700)}`,
      lifetimeSec: 600 + Math.random() * 300
    });

    this.spawnTrack({
      type: "uav",
      lat: 46.45 + (Math.random() - 0.5) * 0.3,
      lon: 33.40 + (Math.random() - 0.5) * 0.3,
      heading: 335 + Math.random() * 15,
      speedKmh: 182 + Math.random() * 12,
      altitudeM: 160 + Math.random() * 70,
      model: "Shahed-136",
      callsign: `SHAHED-${Math.floor(200 + Math.random() * 700)}`,
      lifetimeSec: 650 + Math.random() * 250
    });

    this.spawnTrack({
      type: "uav",
      lat: 46.90 + (Math.random() - 0.5) * 0.3,
      lon: 34.80 + (Math.random() - 0.5) * 0.3,
      heading: 315 + Math.random() * 20,
      speedKmh: 185 + Math.random() * 10,
      altitudeM: 210 + Math.random() * 60,
      model: "Shahed-136",
      callsign: `SHAHED-${Math.floor(200 + Math.random() * 700)}`,
      lifetimeSec: 700 + Math.random() * 200
    });

    // 2. Northern Shahed Group (Kursk / Sumy ingress towards Poltava)
    this.spawnTrack({
      type: "uav",
      lat: 51.20 + (Math.random() - 0.5) * 0.3,
      lon: 34.80 + (Math.random() - 0.5) * 0.3,
      heading: 220 + Math.random() * 20,
      speedKmh: 180 + Math.random() * 14,
      altitudeM: 190 + Math.random() * 90,
      model: "Shahed-136",
      callsign: `SHAHED-${Math.floor(200 + Math.random() * 700)}`,
      lifetimeSec: 650 + Math.random() * 300
    });

    this.spawnTrack({
      type: "uav",
      lat: 50.80 + (Math.random() - 0.5) * 0.3,
      lon: 35.40 + (Math.random() - 0.5) * 0.3,
      heading: 235 + Math.random() * 15,
      speedKmh: 184 + Math.random() * 12,
      altitudeM: 220 + Math.random() * 70,
      model: "Shahed-136",
      callsign: `SHAHED-${Math.floor(200 + Math.random() * 700)}`,
      lifetimeSec: 600 + Math.random() * 250
    });

    // 3. High-Speed Cruise Missile (Kh-101 / Kalibr)
    this.spawnTrack({
      type: "munition",
      lat: 48.90,
      lon: 37.60,
      heading: 275,
      speedKmh: 860,
      altitudeM: 90,
      model: "Kh-101 Cruise Missile",
      callsign: "KH101-TACTICAL",
      lifetimeSec: 450
    });

    this.spawnTrack({
      type: "munition",
      lat: 46.70,
      lon: 32.80,
      heading: 310,
      speedKmh: 840,
      altitudeM: 75,
      model: "3M-54 Kalibr",
      callsign: "KALIBR-04",
      lifetimeSec: 420
    });

    // 4. Ukrainian Air Force Air Defense Patrol (CAP Interceptors)
    this.spawnTrack({
      type: "aircraft",
      lat: 49.80,
      lon: 29.50,
      heading: 105,
      speedKmh: 720,
      altitudeM: 5200,
      model: "F-16AM Fighting Falcon",
      callsign: "PSU-F16",
      lifetimeSec: 1200
    });

    this.spawnTrack({
      type: "aircraft",
      lat: 49.30,
      lon: 34.80,
      heading: 45,
      speedKmh: 750,
      altitudeM: 4800,
      model: "MiG-29MU1 Fulcrum",
      callsign: "GHOST-29",
      lifetimeSec: 1100
    });

    // 5. Recon Drone & SAR Helo
    this.spawnTrack({
      type: "uav",
      lat: 50.60,
      lon: 24.80,
      heading: 30,
      speedKmh: 140,
      altitudeM: 3800,
      model: "Bayraktar TB2 Recon",
      callsign: "BAYRAKTAR-03",
      lifetimeSec: 1800
    });

    this.spawnTrack({
      type: "helicopter",
      lat: 50.25,
      lon: 30.50,
      heading: 160,
      speedKmh: 220,
      altitudeM: 260,
      model: "Mil Mi-8MSB",
      callsign: "SAR-HELO-08",
      lifetimeSec: 1400
    });

    this.lastSpawnTime = now;
  }

  private spawnTrack(params: {
    type: TrackType;
    lat: number;
    lon: number;
    heading: number;
    speedKmh: number;
    altitudeM: number;
    model: string;
    callsign: string;
    lifetimeSec: number;
  }): void {
    const id = this.nextId(params.type === "uav" ? "shd" : params.type === "munition" ? "kr" : "air");
    const speedMs = params.speedKmh / 3.6;

    this.tracks.set(id, {
      id,
      type: params.type,
      lat: params.lat,
      lon: params.lon,
      heading: params.heading,
      speedMs,
      altitudeM: Math.round(params.altitudeM),
      turnRateDegPerSec: 0,
      targetHeading: params.heading,
      nextManeuverTime: Date.now() + 15_000 + Math.random() * 25_000,
      spawnTime: Date.now(),
      maxLifetimeSec: params.lifetimeSec,
      model: params.model,
      callsign: params.callsign
    });
  }

  generateStep(now = Date.now(), activeAlerts: string[] = []): Observation[] {
    const dt = Math.max(0.5, Math.min(4, (now - this.lastTick) / 1000));
    this.lastTick = now;

    // 1. Check for expired tracks & remove them (Interception / Target reached)
    for (const [id, track] of this.tracks.entries()) {
      const ageSec = (now - track.spawnTime) / 1000;
      if (ageSec >= track.maxLifetimeSec) {
        this.tracks.delete(id);
      }
    }

    // 2. Dynamic Wave Spawner: If tracks drop or time elapsed, spawn fresh targets
    const uavCount = [...this.tracks.values()].filter((t) => t.type === "uav").length;
    const munitionCount = [...this.tracks.values()].filter((t) => t.type === "munition").length;

    if (now - this.lastSpawnTime > 90_000 || uavCount < 4) {
      this.lastSpawnTime = now;

      // Spawn 1-2 new Shaheds from random operational ingress vector
      const ingressType = Math.random();
      if (ingressType < 0.4) {
        // Sea of Azov / Primorsko-Akhtarsk ingress
        this.spawnTrack({
          type: "uav",
          lat: 46.50 + (Math.random() - 0.5) * 0.3,
          lon: 36.80 + (Math.random() - 0.5) * 0.4,
          heading: 315 + Math.random() * 25,
          speedKmh: 176 + Math.random() * 16,
          altitudeM: 170 + Math.random() * 90,
          model: "Shahed-136",
          callsign: `SHAHED-${Math.floor(200 + Math.random() * 700)}`,
          lifetimeSec: 650 + Math.random() * 300
        });
      } else if (ingressType < 0.75) {
        // Kursk / Belgorod ingress towards Kharkiv/Poltava
        this.spawnTrack({
          type: "uav",
          lat: 51.35 + (Math.random() - 0.5) * 0.25,
          lon: 35.10 + (Math.random() - 0.5) * 0.4,
          heading: 215 + Math.random() * 25,
          speedKmh: 182 + Math.random() * 14,
          altitudeM: 190 + Math.random() * 80,
          model: "Shahed-136",
          callsign: `SHAHED-${Math.floor(200 + Math.random() * 700)}`,
          lifetimeSec: 620 + Math.random() * 250
        });
      } else {
        // Black Sea / Chauda ingress towards Odesa / Mykolaiv
        this.spawnTrack({
          type: "uav",
          lat: 45.80 + (Math.random() - 0.5) * 0.3,
          lon: 32.50 + (Math.random() - 0.5) * 0.4,
          heading: 325 + Math.random() * 20,
          speedKmh: 180 + Math.random() * 12,
          altitudeM: 150 + Math.random() * 70,
          model: "Shahed-136",
          callsign: `SHAHED-${Math.floor(200 + Math.random() * 700)}`,
          lifetimeSec: 700 + Math.random() * 200
        });
      }

      // If missiles are low, spawn a high-speed cruise missile with dynamic evasive routing
      if (munitionCount < 2) {
        this.spawnTrack({
          type: "munition",
          lat: 48.70 + (Math.random() - 0.5) * 0.6,
          lon: 38.20 + (Math.random() - 0.5) * 0.5,
          heading: 260 + Math.random() * 25,
          speedKmh: 850 + Math.random() * 40,
          altitudeM: 85 + Math.random() * 35,
          model: Math.random() > 0.5 ? "Kh-101 Cruise Missile" : "3M-54 Kalibr",
          callsign: `CRUISE-${Math.floor(10 + Math.random() * 90)}`,
          lifetimeSec: 420 + Math.random() * 150
        });
      }
    }

    const observations: Observation[] = [];

    // 3. Move all active tracks along their trajectory
    for (const track of this.tracks.values()) {
      // Tactical waypoint maneuvers: every 20-40s, alter heading by 15-30 deg to bypass air defense
      if (now >= track.nextManeuverTime) {
        track.nextManeuverTime = now + 20_000 + Math.random() * 35_000;
        const headingDelta = (Math.random() - 0.5) * 40;
        track.targetHeading = (track.heading + headingDelta + 360) % 360;
        track.turnRateDegPerSec = headingDelta > 0 ? 0.8 : -0.8;
      }

      // Smooth turn interpolation
      if (Math.abs(track.heading - track.targetHeading) > 1) {
        track.heading = (track.heading + track.turnRateDegPerSec * dt + 360) % 360;
      } else {
        track.turnRateDegPerSec = 0;
      }

      // Compute next geographic position
      const dist = track.speedMs * dt;
      const nextPos = destinationPoint(track.lat, track.lon, track.heading, dist);
      track.lat = nextPos.lat;
      track.lon = nextPos.lon;

      // Realistic sensor noise (~35m)
      const noiseDistance = 15 + Math.random() * 30;
      const noiseAngle = Math.random() * 360;
      const noisyPos = destinationPoint(track.lat, track.lon, noiseAngle, noiseDistance);

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
        confidence: 0.95,
        meta: {
          callsign: track.callsign,
          model: track.model
        }
      });
    }

    return observations;
  }
}
