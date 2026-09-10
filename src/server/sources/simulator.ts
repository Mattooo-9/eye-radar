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
  isBaseline?: boolean;
}

interface RegionCorridor {
  regionKeyword: string;
  type: TrackType;
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
    regionKeyword: "чернігів",
    type: "uav",
    minLat: 51.2,
    maxLat: 51.8,
    minLon: 31.4,
    maxLon: 32.5,
    headingMin: 215,
    headingMax: 245,
    speedKmhMin: 490,
    speedKmhMax: 540,
    altitudeMin: 400,
    altitudeMax: 700,
    model: "Shahed-238 (Jet)"
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
    regionKeyword: "сум",
    type: "uav",
    minLat: 50.8,
    maxLat: 51.5,
    minLon: 34.0,
    maxLon: 35.1,
    headingMin: 220,
    headingMax: 250,
    speedKmhMin: 490,
    speedKmhMax: 540,
    altitudeMin: 400,
    altitudeMax: 750,
    model: "Shahed-238 (Jet)"
  },
  {
    regionKeyword: "сум",
    type: "bomb",
    minLat: 51.0,
    maxLat: 51.4,
    minLon: 34.6,
    maxLon: 35.2,
    headingMin: 225,
    headingMax: 250,
    speedKmhMin: 810,
    speedKmhMax: 870,
    altitudeMin: 2200,
    altitudeMax: 3500,
    model: "КАБ-500 (УМПК)"
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
    type: "uav",
    minLat: 49.9,
    maxLat: 50.3,
    minLon: 36.3,
    maxLon: 37.3,
    headingMin: 205,
    headingMax: 235,
    speedKmhMin: 480,
    speedKmhMax: 540,
    altitudeMin: 400,
    altitudeMax: 800,
    model: "Shahed-238 (Jet)"
  },
  {
    regionKeyword: "харків",
    type: "bomb",
    minLat: 50.15,
    maxLat: 50.45,
    minLon: 36.4,
    maxLon: 37.1,
    headingMin: 210,
    headingMax: 235,
    speedKmhMin: 810,
    speedKmhMax: 870,
    altitudeMin: 2200,
    altitudeMax: 3500,
    model: "КАБ-500 (УМПК)"
  },
  {
    regionKeyword: "харків",
    type: "fpv",
    minLat: 49.7,
    maxLat: 50.0,
    minLon: 37.4,
    maxLon: 37.9,
    headingMin: 250,
    headingMax: 280,
    speedKmhMin: 90,
    speedKmhMax: 115,
    altitudeMin: 35,
    altitudeMax: 80,
    model: "FPV-дрон (Ударний)"
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
    regionKeyword: "дніпро",
    type: "uav",
    minLat: 48.3,
    maxLat: 48.8,
    minLon: 34.9,
    maxLon: 35.9,
    headingMin: 315,
    headingMax: 345,
    speedKmhMin: 490,
    speedKmhMax: 540,
    altitudeMin: 350,
    altitudeMax: 750,
    model: "Shahed-238 (Jet)"
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
    regionKeyword: "запоріж",
    type: "bomb",
    minLat: 47.45,
    maxLat: 47.85,
    minLon: 35.6,
    maxLon: 36.3,
    headingMin: 320,
    headingMax: 345,
    speedKmhMin: 820,
    speedKmhMax: 880,
    altitudeMin: 2200,
    altitudeMax: 3500,
    model: "КАБ-500 (УМПК)"
  },
  {
    regionKeyword: "запоріж",
    type: "fpv",
    minLat: 47.4,
    maxLat: 47.6,
    minLon: 35.7,
    maxLon: 36.1,
    headingMin: 315,
    headingMax: 340,
    speedKmhMin: 95,
    speedKmhMax: 120,
    altitudeMin: 25,
    altitudeMax: 65,
    model: "FPV-дрон (Оптоволокно)"
  },
  {
    regionKeyword: "донець",
    type: "bomb",
    minLat: 48.3,
    maxLat: 48.8,
    minLon: 37.6,
    maxLon: 38.3,
    headingMin: 275,
    headingMax: 300,
    speedKmhMin: 830,
    speedKmhMax: 890,
    altitudeMin: 2200,
    altitudeMax: 3800,
    model: "КАБ-1500 (УМПК)"
  },
  {
    regionKeyword: "донець",
    type: "fpv",
    minLat: 48.15,
    maxLat: 48.45,
    minLon: 37.4,
    maxLon: 37.8,
    headingMin: 280,
    headingMax: 310,
    speedKmhMin: 90,
    speedKmhMax: 115,
    altitudeMin: 30,
    altitudeMax: 70,
    model: "FPV-дрон (Ударний)"
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
    regionKeyword: "одес",
    type: "uav",
    minLat: 46.2,
    maxLat: 46.9,
    minLon: 30.2,
    maxLon: 31.1,
    headingMin: 320,
    headingMax: 350,
    speedKmhMin: 480,
    speedKmhMax: 540,
    altitudeMin: 350,
    altitudeMax: 700,
    model: "Shahed-238 (Jet)"
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
    regionKeyword: "херсон",
    type: "bomb",
    minLat: 46.7,
    maxLat: 47.1,
    minLon: 33.2,
    maxLon: 33.8,
    headingMin: 305,
    headingMax: 335,
    speedKmhMin: 810,
    speedKmhMax: 870,
    altitudeMin: 2100,
    altitudeMax: 3400,
    model: "КАБ-500 (УМПК)"
  },
  {
    regionKeyword: "херсон",
    type: "fpv",
    minLat: 46.6,
    maxLat: 46.8,
    minLon: 32.7,
    maxLon: 33.1,
    headingMin: 310,
    headingMax: 340,
    speedKmhMin: 90,
    speedKmhMax: 115,
    altitudeMin: 25,
    altitudeMax: 65,
    model: "FPV-дрон (Ударний)"
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

const BASELINE_TACTICAL_CORRIDORS: RegionCorridor[] = [
  // 1. Sumy border sector - Tactical Reconnaissance UAV
  {
    regionKeyword: "сум",
    type: "uav",
    minLat: 50.8,
    maxLat: 51.5,
    minLon: 34.0,
    maxLon: 35.1,
    headingMin: 215,
    headingMax: 245,
    speedKmhMin: 105,
    speedKmhMax: 125,
    altitudeMin: 1500,
    altitudeMax: 2200,
    model: "Supercam S350 Recon"
  },
  // 2. Kharkiv border sector / Kupyansk - Recon UAV
  {
    regionKeyword: "харків",
    type: "uav",
    minLat: 49.8,
    maxLat: 50.3,
    minLon: 36.5,
    maxLon: 37.6,
    headingMin: 200,
    headingMax: 235,
    speedKmhMin: 90,
    speedKmhMax: 110,
    altitudeMin: 1400,
    altitudeMax: 1900,
    model: "ZALA 421-16E Recon"
  },
  // 3. Zaporizhzhia frontline - Scout UAV
  {
    regionKeyword: "запоріж",
    type: "uav",
    minLat: 47.4,
    maxLat: 47.9,
    minLon: 35.3,
    maxLon: 36.5,
    headingMin: 320,
    headingMax: 355,
    speedKmhMin: 95,
    speedKmhMax: 115,
    altitudeMin: 1800,
    altitudeMax: 2400,
    model: "Orlan-30 Scout UAV"
  },
  // 4. Kherson / Dnipro delta - FPV Strike Group
  {
    regionKeyword: "херсон",
    type: "fpv",
    minLat: 46.55,
    maxLat: 46.85,
    minLon: 32.5,
    maxLon: 33.2,
    headingMin: 310,
    headingMax: 345,
    speedKmhMin: 85,
    speedKmhMax: 115,
    altitudeMin: 35,
    altitudeMax: 75,
    model: "FPV-дрон (Ударний)"
  },
  // 5. Central Ukraine Air Defense Combat Air Patrol (CAP)
  {
    regionKeyword: "вінниць",
    type: "aircraft",
    minLat: 49.1,
    maxLat: 49.8,
    minLon: 28.1,
    maxLon: 29.5,
    headingMin: 60,
    headingMax: 120,
    speedKmhMin: 620,
    speedKmhMax: 690,
    altitudeMin: 3800,
    altitudeMax: 5200,
    model: "MiG-29 Fighter (CAP)"
  },
  // 6. Typical Shahed Ingress Vector - North-East
  {
    regionKeyword: "полтав",
    type: "uav",
    minLat: 49.6,
    maxLat: 50.2,
    minLon: 33.8,
    maxLon: 35.0,
    headingMin: 220,
    headingMax: 250,
    speedKmhMin: 180,
    speedKmhMax: 192,
    altitudeMin: 150,
    altitudeMax: 240,
    model: "Shahed-136"
  },
  // 7. Typical Shahed Jet Ingress Vector - South/East
  {
    regionKeyword: "дніпро",
    type: "uav",
    minLat: 48.2,
    maxLat: 48.7,
    minLon: 34.8,
    maxLon: 36.2,
    headingMin: 290,
    headingMax: 320,
    speedKmhMin: 490,
    speedKmhMax: 535,
    altitudeMin: 400,
    altitudeMax: 700,
    model: "Shahed-238 (Jet)"
  },
  // 8. Chernihiv border patrol sector
  {
    regionKeyword: "чернігів",
    type: "uav",
    minLat: 51.3,
    maxLat: 51.9,
    minLon: 31.4,
    maxLon: 32.6,
    headingMin: 210,
    headingMax: 240,
    speedKmhMin: 100,
    speedKmhMax: 120,
    altitudeMin: 1600,
    altitudeMax: 2200,
    model: "Supercam S350 Recon"
  }
];

export class AirspaceSimulator {
  private tracks = new Map<string, DynamicTrack>();
  private alertsSource?: AlertsInUaSource;
  private lastTick = Date.now();
  private lastSpawnCheck = 0;
  private sequence = 100;

  constructor() {
    // Alert-driven + continuous situational awareness simulator
  }

  setAlertsSource(source: AlertsInUaSource): void {
    this.alertsSource = source;
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `tr-${prefix}-${this.sequence}`;
  }

  private spawnTrackFromCorridor(corridor: RegionCorridor, now: number, isBaseline: boolean): void {
    const lat = corridor.minLat + Math.random() * (corridor.maxLat - corridor.minLat);
    const lon = corridor.minLon + Math.random() * (corridor.maxLon - corridor.minLon);
    const heading = corridor.headingMin + Math.random() * (corridor.headingMax - corridor.headingMin);
    const speedKmh = corridor.speedKmhMin + Math.random() * (corridor.speedKmhMax - corridor.speedKmhMin);
    const altitudeM = corridor.altitudeMin + Math.random() * (corridor.altitudeMax - corridor.altitudeMin);

    const prefix =
      corridor.type === "aircraft"
        ? "jet"
        : corridor.type === "uav"
        ? (corridor.model.includes("238") ? "shd2" : "shd")
        : corridor.type === "bomb"
        ? "kab"
        : corridor.type === "fpv"
        ? "fpv"
        : "kr";
    const id = this.nextId(prefix);

    let callsign = `UA-${Math.floor(100 + Math.random() * 899)}`;
    if (corridor.type === "aircraft") {
      callsign = `CAP-GHOST-${Math.floor(10 + Math.random() * 89)}`;
    } else if (corridor.model.includes("238")) {
      callsign = `SHD-238-${Math.floor(100 + Math.random() * 899)}`;
    } else if (corridor.model.includes("Supercam")) {
      callsign = `SCAM-${Math.floor(100 + Math.random() * 899)}`;
    } else if (corridor.model.includes("ZALA")) {
      callsign = `ZALA-${Math.floor(100 + Math.random() * 899)}`;
    } else if (corridor.model.includes("Orlan")) {
      callsign = `ORLAN-${Math.floor(100 + Math.random() * 899)}`;
    } else if (corridor.type === "fpv") {
      callsign = `FPV-${Math.floor(100 + Math.random() * 899)}`;
    } else if (corridor.type === "bomb") {
      callsign = `KAB-${Math.floor(10 + Math.random() * 89)}`;
    } else if (corridor.type === "munition") {
      callsign = `MSL-${Math.floor(10 + Math.random() * 89)}`;
    } else {
      callsign = `SHD-136-${Math.floor(100 + Math.random() * 899)}`;
    }

    const lifetime = isBaseline
      ? (corridor.type === "aircraft" ? 400 + Math.random() * 200 : 260 + Math.random() * 180)
      : (corridor.type === "bomb"
          ? 100 + Math.random() * 60
          : corridor.type === "fpv"
          ? 140 + Math.random() * 60
          : corridor.type === "uav"
          ? 180 + Math.random() * 120
          : 120 + Math.random() * 90);

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
      maxLifetimeSec: lifetime,
      model: corridor.model,
      callsign,
      assignedRegion: corridor.regionKeyword,
      isBaseline
    });
  }

  generateStep(now = Date.now()): Observation[] {
    const dt = Math.max(0.5, Math.min(4, (now - this.lastTick) / 1000));
    this.lastTick = now;

    // Get real active alarms from alerts.in.ua
    const activeOblasts = this.alertsSource ? this.alertsSource.getActiveAlertOblastNames() : [];

    // 1. Remove expired tracks (with impact/interception event)
    for (const [id, track] of this.tracks.entries()) {
      if (track.maxLifetimeSec < 900000) {
        const ageSec = (now - track.spawnTime) / 1000;

        // If target reached terminal destination: record impact or interception & DELETE
        if (ageSec >= track.maxLifetimeSec) {
          if (track.type === "uav" || track.type === "munition" || track.type === "bomb" || track.type === "fpv") {
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
          }
          this.tracks.delete(id);
          continue;
        }

        // If alert-driven track and assigned region alarm has cleared: DELETE
        if (
          !track.isBaseline &&
          track.assignedRegion &&
          (activeOblasts.length > 0 && !activeOblasts.some((o) => o.toLowerCase().includes(track.assignedRegion!)))
        ) {
          this.tracks.delete(id);
          continue;
        }
      }
    }

    // 2. Synchronize threats strictly with currently alarmed Ukrainian oblasts + baseline corridors
    if (now - this.lastSpawnCheck > 10_000 || this.tracks.size === 0) {
      this.lastSpawnCheck = now;

      // A. Alert-correlated corridors (when sirens are active)
      if (activeOblasts.length > 0) {
        const matchingCorridors = REGION_CORRIDORS.filter((corridor) =>
          activeOblasts.some((oblast) => oblast.toLowerCase().includes(corridor.regionKeyword))
        );

        for (const corridor of matchingCorridors) {
          const activeInCorridor = [...this.tracks.values()].filter(
            (t) => !t.isBaseline && t.assignedRegion === corridor.regionKeyword
          ).length;

          if (activeInCorridor < 2) {
            this.spawnTrackFromCorridor(corridor, now, false);
          }
        }
      }

      // B. Baseline Tactical Corridors (continuous border/frontline situational awareness)
      for (const corridor of BASELINE_TACTICAL_CORRIDORS) {
        const activeInCorridor = [...this.tracks.values()].filter(
          (t) => t.isBaseline && t.assignedRegion === corridor.regionKeyword
        ).length;

        if (activeInCorridor < 1) {
          this.spawnTrackFromCorridor(corridor, now, true);
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

      observations.push({
        id: track.id,
        type: track.type,
        lat: Number(track.lat.toFixed(6)),
        lon: Number(track.lon.toFixed(6)),
        heading: Math.round(track.heading),
        speed: Math.round(track.speedMs),
        altitude: track.altitudeM,
        timestamp: now,
        source: "sdr",
        confidence: 0.98,
        meta: {
          callsign: track.callsign,
          model: track.model
        }
      });
    }

    return observations;
  }
}
