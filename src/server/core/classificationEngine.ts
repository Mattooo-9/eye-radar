import type { TrackType } from "../domain/types.js";

export interface ClassificationAlternative {
  type: TrackType;
  model: string;
  confidence: number;
}

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
  previousModel?: string;
}

export interface ClassificationOutput {
  resolvedType: TrackType;
  resolvedModel: string;
  confidence: number;
  alternative?: ClassificationAlternative;
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
 * Returns primary classification and nearest plausible alternative.
 */
export function classifyAerialObject(input: ClassificationInput): ClassificationOutput {
  const speedKmh = Math.round(input.speedMs * 3.6);
  const evidence = [...(input.evidence ?? [])];
  const isMeasuredSpeed = input.measuredSpeed !== undefined;
  const isMeasuredAltitude = input.measuredAltitude !== undefined;
  const alt = input.measuredAltitude ?? input.altitudeM ?? (input.claimedType === "munition" ? 150 : 250);

  // 1. Civil or Military Aircraft / Helicopters with transponder (ADS-B / Mode-S)
  if (input.claimedType === "aircraft" || input.claimedType === "helicopter") {
    const isHeli = input.claimedType === "helicopter";
    evidence.push(isHeli ? "rotary_wing_profile" : "fixed_wing_adsb");
    return {
      resolvedType: input.claimedType,
      resolvedModel: input.modelHint || (isHeli ? "Helicopter" : "Aircraft"),
      confidence: 0.96,
      alternative: isHeli
        ? { type: "aircraft", model: "Турбогвинтовий літак", confidence: 0.25 }
        : { type: "helicopter", model: "Гелікоптер", confidence: 0.20 },
      evidence,
      propulsion: isHeli ? "turboshaft" : "turbofan",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 2. Cruise Missiles / Ballistics
  if (input.claimedType === "munition" || speedKmh > 650) {
    if (speedKmh > 1200) {
      evidence.push("hyper_high_velocity_ballistic");
      return {
        resolvedType: "munition",
        resolvedModel: input.modelHint || "Іскандер-М / Кинджал (Балістика)",
        confidence: 0.94,
        alternative: {
          type: "munition",
          model: "Х-101 / Калібр (Крилата ракета)",
          confidence: 0.40
        },
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
      alternative: {
        type: "uav",
        model: "Shahed-238 (Jet)",
        confidence: 0.55
      },
      evidence,
      propulsion: "turbojet",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 3. Guided Glide Bombs (KAB / UMPK)
  if (
    input.claimedType === "bomb" ||
    (speedKmh >= 380 &&
      speedKmh <= 750 &&
      alt < 4500 &&
      (input.modelHint?.includes("КАБ") || input.modelHint?.includes("KAB")))
  ) {
    evidence.push("aerodynamic_glide_umpk");
    return {
      resolvedType: "bomb",
      resolvedModel: input.modelHint || "КАБ-500 з УМПК",
      confidence: 0.91,
      alternative: {
        type: "munition",
        model: "Х-59 / Х-69 (Крилата ракета)",
        confidence: 0.48
      },
      evidence,
      propulsion: "glide",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 4. FPV Strike Quads
  if (
    input.claimedType === "fpv" ||
    (speedKmh < 160 &&
      alt < 120 &&
      (input.modelHint?.includes("FPV") || input.modelHint?.includes("Квадрокоптер")))
  ) {
    evidence.push("rotary_quad_low_level");
    return {
      resolvedType: "fpv",
      resolvedModel: input.modelHint || "FPV-дрон (Ударний квадрокоптер)",
      confidence: 0.90,
      alternative: {
        type: "uav",
        model: "Малий розвідувальний БПЛА (Mavic/Autel)",
        confidence: 0.45
      },
      evidence,
      propulsion: "electric",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 5. Very low speed or unconfirmed observation -> UNKNOWN (until multi-observation confirmation)
  if (speedKmh < 35 && input.claimedType === "unknown") {
    evidence.push("insufficient_kinematic_data");
    return {
      resolvedType: "unknown",
      resolvedModel: "Невідома повітряна ціль (мала швидкість)",
      confidence: 0.40,
      alternative: {
        type: "uav",
        model: "БПЛА (потребує накопичення треку)",
        confidence: 0.35
      },
      evidence,
      propulsion: "unknown",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 6. UAVs: Strict Separation between Shahed-238 vs Shahed-136 vs Recon
  if (input.claimedType === "uav" || input.claimedType === "unknown") {
    const hintLower = (input.modelHint || "").toLowerCase();
    const hasJetHint =
      hintLower.includes("238") ||
      hintLower.includes("jet") ||
      hintLower.includes("реактив") ||
      hintLower.includes("турбореактив") ||
      hintLower.includes("toloue");

    const hasReconHint =
      hintLower.includes("supercam") ||
      hintLower.includes("orlan") ||
      hintLower.includes("zala") ||
      hintLower.includes("розвід") ||
      hintLower.includes("shark");

    // A. Reconnaissance UAV: Low loitering speed (< 135 km/h) or explicit recon hint
    if ((speedKmh < 135 && !hasJetHint) || hasReconHint) {
      evidence.push("loitering_recon_velocity", "optical_recon_payload");
      return {
        resolvedType: "uav",
        resolvedModel: input.modelHint || "Supercam S350 Recon",
        confidence: 0.92,
        alternative: {
          type: "uav",
          model: "Shahed-136 (уповільнений політ)",
          confidence: 0.38
        },
        evidence,
        propulsion: "electric",
        isMeasuredSpeed,
        isMeasuredAltitude,
        speedKmh,
        estimatedAltitudeM: alt
      };
    }

    // B. Turbojet Shahed-238: Speed >= 310 km/h OR explicit jet hint OR (speed >= 235 km/h with high altitude > 600m)
    // High-speed cruise profile (Toloue-10 / TJ-100 micro-turbojet)
    const isHighAltitude = alt > 600;
    if (speedKmh >= 310 || (hasJetHint && speedKmh >= 215) || (speedKmh >= 235 && isHighAltitude)) {
      evidence.push("turbojet_toloue_10_speed_profile", "black_ram_stealth");
      return {
        resolvedType: "uav",
        resolvedModel: "Shahed-238 (Jet)",
        confidence: 0.94,
        alternative: speedKmh > 500
          ? { type: "munition", model: "Х-101 / Калібр (Крилата ракета)", confidence: 0.60 }
          : { type: "uav", model: "Shahed-136 (пікірування)", confidence: 0.35 },
        evidence,
        propulsion: "turbojet",
        isMeasuredSpeed,
        isMeasuredAltitude,
        speedKmh,
        estimatedAltitudeM: alt
      };
    }

    // C. Transitional speed band (215 km/h - 309 km/h) without explicit jet evidence:
    // Hysteresis: do not flip to Shahed-238 on a brief speed noise spike!
    if (speedKmh >= 215 && speedKmh < 310) {
      evidence.push("transitional_speed_band", "md550_dive_or_tailwind");
      return {
        resolvedType: "uav",
        resolvedModel: "Shahed-136",
        confidence: 0.78,
        alternative: {
          type: "uav",
          model: "Shahed-238 (Jet)",
          confidence: 0.65
        },
        evidence,
        propulsion: "piston",
        isMeasuredSpeed,
        isMeasuredAltitude,
        speedKmh,
        estimatedAltitudeM: alt
      };
    }

    // D. Piston Shahed-136: Standard envelope (135 - 214 km/h), MD-550 pusher prop, low altitude
    evidence.push("md550_piston_propeller_velocity", "delta_wing_acoustic_moped");
    return {
      resolvedType: "uav",
      resolvedModel: "Shahed-136",
      confidence: 0.95,
      alternative: {
        type: "uav",
        model: "Shahed-238 (Jet)",
        confidence: 0.25
      },
      evidence,
      propulsion: "piston",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // Fallback UNKNOWN
  return {
    resolvedType: "unknown",
    resolvedModel: input.modelHint || "Невідома повітряна ціль",
    confidence: 0.5,
    alternative: {
      type: "uav",
      model: "БПЛА",
      confidence: 0.40
    },
    evidence,
    propulsion: "unknown",
    isMeasuredSpeed,
    isMeasuredAltitude,
    speedKmh,
    estimatedAltitudeM: alt
  };
}
