import { destinationPoint } from "../domain/geo.js";
import type { Observation, TrackType } from "../domain/types.js";

interface SimEntity {
  id: string;
  type: TrackType;
  lat: number;
  lon: number;
  heading: number;
  speedMs: number;
  altitudeM: number;
  turnRateDegPerSec: number;
  lifetimeSec: number;
  ageSec: number;
  initialLat: number;
  initialLon: number;
  initialHeading: number;
  model: string;
  callsign: string;
}

export class AirspaceSimulator {
  private entities: SimEntity[] = [];
  private lastTick = Date.now();

  constructor() {
    this.resetScenario();
  }

  resetScenario(): void {
    this.entities = [
      // 1. Northern Shahed-136 Group (Kursk / Bryansk border towards Poltava / Cherkasy)
      {
        id: "sim-shahed-381",
        type: "uav",
        lat: 51.30,
        lon: 34.85,
        heading: 218,
        speedMs: 51,
        altitudeM: 210,
        turnRateDegPerSec: -0.06,
        lifetimeSec: 900,
        ageSec: 0,
        initialLat: 51.30,
        initialLon: 34.85,
        initialHeading: 218,
        model: "Shahed-136",
        callsign: "SHAHED-381"
      },
      {
        id: "sim-shahed-382",
        type: "uav",
        lat: 51.45,
        lon: 34.30,
        heading: 212,
        speedMs: 50,
        altitudeM: 190,
        turnRateDegPerSec: 0.04,
        lifetimeSec: 900,
        ageSec: 0,
        initialLat: 51.45,
        initialLon: 34.30,
        initialHeading: 212,
        model: "Shahed-136",
        callsign: "SHAHED-382"
      },
      {
        id: "sim-shahed-385",
        type: "uav",
        lat: 50.90,
        lon: 35.25,
        heading: 232,
        speedMs: 53,
        altitudeM: 240,
        turnRateDegPerSec: -0.05,
        lifetimeSec: 850,
        ageSec: 0,
        initialLat: 50.90,
        initialLon: 35.25,
        initialHeading: 232,
        model: "Shahed-136",
        callsign: "SHAHED-385"
      },

      // 2. Southern Shahed-136 Group (Black Sea / Crimea approach towards Mykolaiv / Dnipro)
      {
        id: "sim-shahed-412",
        type: "uav",
        lat: 46.45,
        lon: 31.65,
        heading: 334,
        speedMs: 49,
        altitudeM: 160,
        turnRateDegPerSec: 0.05,
        lifetimeSec: 800,
        ageSec: 0,
        initialLat: 46.45,
        initialLon: 31.65,
        initialHeading: 334,
        model: "Shahed-136",
        callsign: "SHAHED-412"
      },
      {
        id: "sim-shahed-414",
        type: "uav",
        lat: 47.15,
        lon: 33.60,
        heading: 342,
        speedMs: 52,
        altitudeM: 180,
        turnRateDegPerSec: -0.04,
        lifetimeSec: 850,
        ageSec: 0,
        initialLat: 47.15,
        initialLon: 33.60,
        initialHeading: 342,
        model: "Shahed-136",
        callsign: "SHAHED-414"
      },
      {
        id: "sim-shahed-418",
        type: "uav",
        lat: 46.95,
        lon: 36.40,
        heading: 318,
        speedMs: 51,
        altitudeM: 220,
        turnRateDegPerSec: 0.03,
        lifetimeSec: 800,
        ageSec: 0,
        initialLat: 46.95,
        initialLon: 36.40,
        initialHeading: 318,
        model: "Shahed-136",
        callsign: "SHAHED-418"
      },

      // 3. High-Speed Cruise Missiles (Low altitude terrain following)
      {
        id: "sim-missile-kh101",
        type: "munition",
        lat: 49.10,
        lon: 37.40,
        heading: 268,
        speedMs: 245, // 882 km/h
        altitudeM: 95,
        turnRateDegPerSec: -0.08,
        lifetimeSec: 650,
        ageSec: 0,
        initialLat: 49.10,
        initialLon: 37.40,
        initialHeading: 268,
        model: "Kh-101 Cruise Missile",
        callsign: "KH101-TACTICAL"
      },
      {
        id: "sim-missile-kalibr",
        type: "munition",
        lat: 46.85,
        lon: 32.50,
        heading: 312,
        speedMs: 235, // 846 km/h
        altitudeM: 75,
        turnRateDegPerSec: 0.06,
        lifetimeSec: 600,
        ageSec: 0,
        initialLat: 46.85,
        initialLon: 32.50,
        initialHeading: 312,
        model: "3M-54 Kalibr",
        callsign: "KALIBR-04"
      },

      // 4. Ukrainian Air Force Combat Air Patrol (CAP Interceptors)
      {
        id: "sim-psu-f16-01",
        type: "aircraft",
        lat: 49.75,
        lon: 29.20,
        heading: 98,
        speedMs: 195, // ~700 km/h
        altitudeM: 5200,
        turnRateDegPerSec: 0.12,
        lifetimeSec: 1200,
        ageSec: 0,
        initialLat: 49.75,
        initialLon: 29.20,
        initialHeading: 98,
        model: "F-16AM Fighting Falcon",
        callsign: "PSU-F16"
      },
      {
        id: "sim-psu-mig29",
        type: "aircraft",
        lat: 49.40,
        lon: 34.60,
        heading: 42,
        speedMs: 205, // ~738 km/h
        altitudeM: 4600,
        turnRateDegPerSec: -0.15,
        lifetimeSec: 1100,
        ageSec: 0,
        initialLat: 49.40,
        initialLon: 34.60,
        initialHeading: 42,
        model: "MiG-29MU1 Fulcrum",
        callsign: "GHOST-29"
      },

      // 5. Tactical Reconnaissance Drone & SAR Helicopter
      {
        id: "sim-ua-tb2-03",
        type: "uav",
        lat: 50.85,
        lon: 24.50,
        heading: 20,
        speedMs: 38,
        altitudeM: 4200,
        turnRateDegPerSec: 0.2,
        lifetimeSec: 1500,
        ageSec: 0,
        initialLat: 50.85,
        initialLon: 24.50,
        initialHeading: 20,
        model: "Bayraktar TB2 Recon",
        callsign: "BAYRAKTAR-03"
      },
      {
        id: "sim-ua-mi8-helo",
        type: "helicopter",
        lat: 50.15,
        lon: 30.65,
        heading: 155,
        speedMs: 62,
        altitudeM: 280,
        turnRateDegPerSec: 0.08,
        lifetimeSec: 1000,
        ageSec: 0,
        initialLat: 50.15,
        initialLon: 30.65,
        initialHeading: 155,
        model: "Mil Mi-8MSB",
        callsign: "SAR-HELO-08"
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

      // Add realistic measurement noise (~60m tactical sensor variance)
      const noiseDistance = 20 + Math.random() * 50;
      const noiseAngle = Math.random() * 360;
      const noisyPos = destinationPoint(entity.lat, entity.lon, noiseAngle, noiseDistance);

      observations.push({
        id: entity.id,
        type: entity.type,
        lat: Number(noisyPos.lat.toFixed(5)),
        lon: Number(noisyPos.lon.toFixed(5)),
        heading: Math.round(entity.heading),
        speed: Math.round(entity.speedMs),
        altitude: entity.altitudeM,
        timestamp: now,
        source: "sdr",
        confidence: 0.94,
        meta: {
          callsign: entity.callsign,
          model: entity.model
        }
      });

      // Respawn if lifetime exceeded
      if (entity.ageSec >= entity.lifetimeSec) {
        entity.ageSec = 0;
        entity.lat = entity.initialLat;
        entity.lon = entity.initialLon;
        entity.heading = entity.initialHeading;
      }
    }

    return observations;
  }
}
