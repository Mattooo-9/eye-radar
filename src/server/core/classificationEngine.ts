import type { TrackType } from "../domain/types.js";

export interface ClassificationInput {
  claimedType: TrackType | "unknown";
  speedMs: number;
  measuredSpeed?: number;
  altitudeM?: number;
  measuredAltitude?: number;
  headingDeg: number;
  modelHint?: string;
  callsign?: string;
  sources: string[];
  evidence?: string[];
  turnRateDegPerSec?: number;
}

export interface ClassificationOutput {
  resolvedType: TrackType;
  resolvedModel: string;
  confidence: number;
  evidence: string[];
  propulsion: "turbojet" | "piston" | "rocket" | "turbofan" | "turboshaft" | "electric" | "glide" | "unknown";
  isMeasuredSpeed: boolean;
  isMeasuredAltitude: boolean;
  speedKmh: number;
  estimatedAltitudeM: number;
}

/**
 * Deterministic physics-based classifier distinguishing aerial objects
 * Strictly separating Shahed-238 (turbojet) from Shahed-136 (piston),
 * reconnaissance UAVs, cruise missiles, glide bombs, and aircraft.
 */
export function classifyAerialObject(input: ClassificationInput): ClassificationOutput {
  const speedKmh = Math.round(input.speedMs * 3.6);
  const evidence = [...(input.evidence ?? [])];
  const isMeasuredSpeed = input.measuredSpeed !== undefined;
  const isMeasuredAltitude = input.measuredAltitude !== undefined;
  const alt = input.measuredAltitude ?? input.altitudeM ?? (input.claimedType === "munition" ? 150 : 250);

  // 1. Civil or Military Aircraft / Helicopters with transponder
  if (input.claimedType === "aircraft" || input.claimedType === "helicopter") {
    const isHeli = input.claimedType === "helicopter";
    evidence.push(isHeli ? "rotary_wing_profile" : "fixed_wing_adsb");
    return {
      resolvedType: input.claimedType,
      resolvedModel: input.modelHint || (isHeli ? "Helicopter" : "Aircraft"),
      confidence: 0.96,
      evidence,
      propulsion: isHeli ? "turboshaft" : "turbofan",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 2. Cruise Missiles / Ballistics
  if (input.claimedType === "munition") {
    if (speedKmh > 1200) {
      evidence.push("hyper_high_velocity_ballistic");
      return {
        resolvedType: "munition",
        resolvedModel: input.modelHint || "Іскандер-М / Кинджал (Балістика)",
        confidence: 0.94,
        evidence,
        propulsion: "rocket",
        isMeasuredSpeed,
        isMeasuredAltitude,
        speedKmh,
        estimatedAltitudeM: alt
      };
    }

    evidence.push("terrain_hugging_transonic_cruise");
    return {
      resolvedType: "munition",
      resolvedModel: input.modelHint || "Х-101 / Калібр (Крилата ракета)",
      confidence: 0.92,
      evidence,
      propulsion: "turbojet",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 3. Guided Glide Bombs (KAB)
  if (input.claimedType === "bomb" || speedKmh >= 380 && speedKmh <= 750 && alt < 4000 && (input.modelHint?.includes("КАБ") || input.modelHint?.includes("KAB"))) {
    evidence.push("aerodynamic_glide_umpk");
    return {
      resolvedType: "bomb",
      resolvedModel: input.modelHint || "КАБ-500 з УМПК",
      confidence: 0.91,
      evidence,
      propulsion: "glide",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 4. FPV Strike Quads
  if (input.claimedType === "fpv" || (speedKmh < 160 && alt < 120 && (input.modelHint?.includes("FPV") || input.modelHint?.includes("Дрон")))) {
    evidence.push("rotary_quad_low_level");
    return {
      resolvedType: "fpv",
      resolvedModel: input.modelHint || "FPV-дрон (Ударний квадрокоптер)",
      confidence: 0.9,
      evidence,
      propulsion: "electric",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 5. UAVs: Strict Separation between Shahed-238 vs Shahed-136 vs Recon
  if (input.claimedType === "uav" || input.claimedType === "unknown") {
    // A. Turbojet Shahed-238: Speed >= 235 km/h OR explicitly reported as turbojet/black/reactive
    const hasJetHint = input.modelHint?.includes("238") || input.modelHint?.includes("Jet") || input.modelHint?.includes("реактив");
    if (speedKmh >= 235 || hasJetHint) {
      evidence.push("turbojet_toloue_10_speed_profile", "black_ram_stealth");
      return {
        resolvedType: "uav",
        resolvedModel: "Shahed-238 (Jet)",
        confidence: 0.95,
        evidence,
        propulsion: "turbojet",
        isMeasuredSpeed,
        isMeasuredAltitude,
        speedKmh,
        estimatedAltitudeM: alt
      };
    }

    // B. Reconnaissance UAV: Speed < 135 km/h
    const hasReconHint = input.modelHint?.includes("Supercam") || input.modelHint?.includes("Orlan") || input.modelHint?.includes("ZALA") || input.modelHint?.includes("розвід");
    if (speedKmh < 135 || hasReconHint) {
      evidence.push("loitering_recon_velocity", "optical_recon_payload");
      return {
        resolvedType: "uav",
        resolvedModel: input.modelHint || "Supercam S350 Recon",
        confidence: 0.92,
        evidence,
        propulsion: "electric",
        isMeasuredSpeed,
        isMeasuredAltitude,
        speedKmh,
        estimatedAltitudeM: alt
      };
    }

    // C. Piston Shahed-136: Speed between 135 and 234 km/h, pusher prop sound, low altitude
    evidence.push("md550_piston_propeller_velocity", "delta_wing_acoustic_moped");
    return {
      resolvedType: "uav",
      resolvedModel: "Shahed-136",
      confidence: 0.95,
      evidence,
      propulsion: "piston",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  return {
    resolvedType: "unknown",
    resolvedModel: input.modelHint || "Невідома повітряна ціль",
    confidence: 0.5,
    evidence,
    propulsion: "unknown",
    isMeasuredSpeed,
    isMeasuredAltitude,
    speedKmh,
    estimatedAltitudeM: alt
  };
}
