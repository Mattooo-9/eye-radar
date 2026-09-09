import { destinationPoint } from "../domain/geo.js";
import type { Observation, TrackType } from "../domain/types.js";

interface SimEntity {
  id: string;
  type: TrackType;
  lat: number;
  lon: number;
  heading: number;
  speedMs: number;
  turnRateDegPerSec: number;
  lifetimeSec: number;
  ageSec: number;
}

export class AirspaceSimulator {
  private entities: SimEntity[] = [];
  private lastTick = Date.now();

  constructor() {
    this.resetScenario();
  }

  resetScenario(): void {
    this.entities = [
      // Shahed UAV group entering from Sumy border towards Poltava
      {
        id: "sim-shahed-01",
        type: "uav",
        lat: 51.15,
        lon: 34.95,
        heading: 215,
        speedMs: 52, // ~187 km/h
        turnRateDegPerSec: -0.15,
        lifetimeSec: 600,
        ageSec: 0
      },
      {
        id: "sim-shahed-02",
        type: "uav",
        lat: 51.08,
        lon: 35.12,
        heading: 220,
        speedMs: 50,
        turnRateDegPerSec: -0.1,
        lifetimeSec: 600,
        ageSec: 0
      },
      // Shahed flying from south towards Dnipro/Kryvyi Rih
      {
        id: "sim-shahed-03",
        type: "uav",
        lat: 47.12,
        lon: 33.85,
        heading: 350,
        speedMs: 48,
        turnRateDegPerSec: 0.1,
        lifetimeSec: 500,
        ageSec: 0
      },
      // Cruise missile simulation (fast, direct)
      {
        id: "sim-missile-101",
        type: "munition",
        lat: 48.95,
        lon: 36.80,
        heading: 260,
        speedMs: 230, // ~830 km/h
        turnRateDegPerSec: -0.05,
        lifetimeSec: 350,
        ageSec: 0
      },
      // Civilian / patrol flight near western border
      {
        id: "sim-patrol-07",
        type: "aircraft",
        lat: 49.70,
        lon: 23.60,
        heading: 110,
        speedMs: 160,
        turnRateDegPerSec: 0.0,
        lifetimeSec: 800,
        ageSec: 0
      }
    ];
  }

  generateStep(now = Date.now()): Observation[] {
    const dt = Math.max(0.5, Math.min(5, (now - this.lastTick) / 1000));
    this.lastTick = now;

    const observations: Observation[] = [];

    for (const entity of this.entities) {
      entity.ageSec += dt;
      entity.heading = (entity.heading + entity.turnRateDegPerSec * dt + 360) % 360;

      const dist = entity.speedMs * dt;
      const nextPos = destinationPoint(entity.lat, entity.lon, entity.heading, dist);
      entity.lat = nextPos.lat;
      entity.lon = nextPos.lon;

      // Add realistic measurement noise (~150m GPS / sensor variance)
      const noiseDistance = 50 + Math.random() * 120;
      const noiseAngle = Math.random() * 360;
      const noisyPos = destinationPoint(entity.lat, entity.lon, noiseAngle, noiseDistance);

      observations.push({
        id: entity.id,
        type: entity.type,
        lat: Number(noisyPos.lat.toFixed(6)),
        lon: Number(noisyPos.lon.toFixed(6)),
        heading: Math.round(entity.heading),
        speed: Math.round(entity.speedMs),
        timestamp: now,
        source: "simulation",
        confidence: 0.88
      });

      // Respawn if lifetime exceeded
      if (entity.ageSec >= entity.lifetimeSec) {
        entity.ageSec = 0;
        if (entity.id === "sim-shahed-01") {
          entity.lat = 51.15;
          entity.lon = 34.95;
          entity.heading = 215;
        } else if (entity.id === "sim-missile-101") {
          entity.lat = 48.95;
          entity.lon = 36.80;
          entity.heading = 260;
        }
      }
    }

    return observations;
  }
}
