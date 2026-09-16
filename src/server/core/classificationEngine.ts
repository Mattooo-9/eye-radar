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
  threatEvidence?: string[];
  turnRateDegPerSec?: number;
  previousModel?: string;
  isSynthetic?: boolean;
  positionConfidence?: number;
  hasActiveRegionalAlert?: boolean;
}

export interface ClassificationOutput {
  resolvedType: TrackType;
  resolvedModel: string;
  confidence: number;
  positionConfidence: number;
  classConfidence: number;
  classEvidence: string[];
  threatEvidence: string[];
  alternative?: ClassificationAlternative;
  evidence: string[];
  propulsion: "turbojet" | "piston" | "rocket" | "turbofan" | "turboshaft" | "electric" | "glide" | "unknown";
  isMeasuredSpeed: boolean;
  isMeasuredAltitude: boolean;
  speedKmh: number;
  estimatedAltitudeM: number;
}

function isHelicopterModel(text?: string): boolean {
  if (!text) return false;
  const upper = text.toUpperCase();
  return (
    upper.includes("HELICOPTER") ||
    upper.includes("ROTORCRAFT") ||
    upper.includes("BELL") ||
    upper.includes("SIKORSKY") ||
    upper.includes("EUROCOPTER") ||
    upper.includes("EC1") ||
    upper.includes("EC2") ||
    upper.includes("H125") ||
    upper.includes("H135") ||
    upper.includes("H145") ||
    upper.includes("MI-8") ||
    upper.includes("MI-2") ||
    upper.includes("MI-24") ||
    upper.includes("KA-52") ||
    upper.includes("R44") ||
    upper.includes("R66") ||
    upper.includes("ГЕЛІКОПТЕР") ||
    upper.includes("ВЕРТОЛЕТ")
  );
}

function isVerifiedAircraftModel(text?: string): boolean {
  if (!text) return false;
  const upper = text.toUpperCase();
  return (
    upper.includes("AIRCRAFT") ||
    upper.includes("AIRPLANE") ||
    upper.includes("BOEING") ||
    upper.includes("AIRBUS") ||
    upper.includes("B73") ||
    upper.includes("B77") ||
    upper.includes("B78") ||
    upper.includes("A320") ||
    upper.includes("A321") ||
    upper.includes("A330") ||
    upper.includes("A350") ||
    upper.includes("EMBRAER") ||
    upper.includes("BOMBARDIER") ||
    upper.includes("ATR") ||
    upper.includes("SAAB") ||
    upper.includes("GULFSTREAM") ||
    upper.includes("DASSAULT") ||
    upper.includes("FALCON") ||
    upper.includes("CESSNA") ||
    upper.includes("PIPER") ||
    upper.includes("BEECH") ||
    upper.includes("ANTONOV") ||
    upper.includes("AN-") ||
    upper.includes("SU-") ||
    upper.includes("MIG-") ||
    upper.includes("F-16") ||
    upper.includes("F-15") ||
    upper.includes("C-130") ||
    upper.includes("IL-76") ||
    upper.includes("BAYRAKTAR") ||
    upper.includes("TB2") ||
    upper.includes("L-39") ||
    upper.includes("ЛІТАК") ||
    upper.includes("САМОЛЕТ")
  );
}

/**
 * Deterministic evidence-gated classifier distinguishing aerial objects.
 * ADS-B/MLAT/OpenSky confirm only position and kinematics, NOT combat types.
 * Combat types strictly require independent confirming sensor evidence or simulation.
 */
export function classifyAerialObject(input: ClassificationInput): ClassificationOutput {
  const speedKmh = Math.round(input.speedMs * 3.6);
  const isMeasuredSpeed = input.measuredSpeed !== undefined;
  const isMeasuredAltitude = input.measuredAltitude !== undefined;
  const alt = input.measuredAltitude ?? input.altitudeM ?? (input.claimedType === "munition" ? 150 : 250);

  // Position confidence: high for direct positional feeds (ADS-B, radar, SDR)
  const posConf = input.positionConfidence ?? (
    input.sources.some(s =>
      s.includes("adsb") || s.includes("airplanes") || s.includes("opensky") ||
      s.includes("sdr") || s.includes("radar") || s.includes("ground")
    ) ? 0.96 : 0.82
  );

  // Extract independent threat evidence from connected sensors (acoustic, optical, radar)
  const threatEvidenceList = [
    ...(input.threatEvidence ?? []),
    ...(input.evidence ?? []).filter(e =>
      e.startsWith("acoustic_") ||
      e.startsWith("optical_") ||
      e.startsWith("radar_") ||
      e.startsWith("threat_") ||
      e.includes("shahed") ||
      e.includes("missile") ||
      e.includes("kab") ||
      e.includes("ballistic")
    )
  ];

  const hasSensorThreatEvidence = threatEvidenceList.length > 0;
  const isSyntheticCombat = Boolean(input.isSynthetic);
  const hasCombatEvidence = hasSensorThreatEvidence || isSyntheticCombat;

  // Strict pure transponder sources (ADS-B / MLAT / OpenSky)
  const transponderSourceNames = new Set([
    "adsb", "adsb.lol", "airplanes.live", "opensky", "opensky.live", "mlat", "mode-s"
  ]);
  const isTransponderOnly = input.sources.length > 0 && input.sources.every(s =>
    transponderSourceNames.has(s.toLowerCase())
  );

  const baseEvidence = [...(input.evidence ?? [])];

  // 1. Helicopter with transponder metadata or explicit rotary wing profile
  if (
    input.claimedType === "helicopter" ||
    isHelicopterModel(input.modelHint) ||
    isHelicopterModel(input.callsign)
  ) {
    const classEv = [...baseEvidence, "rotary_wing_profile", "transponder_metadata"];
    return {
      resolvedType: "helicopter",
      resolvedModel: input.modelHint || "Гелікоптер",
      confidence: Math.min(posConf, 0.92),
      positionConfidence: posConf,
      classConfidence: 0.92,
      classEvidence: classEv,
      threatEvidence: threatEvidenceList,
      alternative: { type: "aircraft", model: "Турбогвинтовий літак", confidence: 0.20 },
      evidence: classEv,
      propulsion: "turboshaft",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 2. Verified Fixed-Wing Aircraft with transponder metadata
  if (
    input.claimedType === "aircraft" ||
    isVerifiedAircraftModel(input.modelHint)
  ) {
    const classEv = [...baseEvidence, "fixed_wing_adsb", "transponder_metadata"];
    return {
      resolvedType: "aircraft",
      resolvedModel: input.modelHint || "Літак",
      confidence: Math.min(posConf, 0.90),
      positionConfidence: posConf,
      classConfidence: 0.90,
      classEvidence: classEv,
      threatEvidence: threatEvidenceList,
      alternative: { type: "helicopter", model: "Гелікоптер", confidence: 0.15 },
      evidence: classEv,
      propulsion: speedKmh > 400 ? "turbofan" : "turboshaft",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 3. PURE ADS-B / MLAT / OpenSky WITHOUT independent threat evidence:
  // Strictly FORBID combat types (Shahed, Missile, KAB, FPV).
  // Always resolve to real aircraft metadata or UNKNOWN AIR TARGET.
  if (isTransponderOnly && !hasCombatEvidence) {
    const classEv = [...baseEvidence, "adsb_mlat_kinematics_only", "unconfirmed_threat_evidence_absent"];
    return {
      resolvedType: "unknown",
      resolvedModel: "Невідома повітряна ціль",
      confidence: Math.min(posConf, 0.45),
      positionConfidence: posConf,
      classConfidence: 0.40,
      classEvidence: classEv,
      threatEvidence: [],
      alternative: speedKmh > 350
        ? { type: "aircraft", model: "Літак (транспондер/MLAT)", confidence: 0.35 }
        : { type: "unknown", model: "Повітряний об'єкт", confidence: 0.25 },
      evidence: classEv,
      propulsion: "unknown",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 4. UNKNOWN CLAIMED TYPE WITHOUT SENSOR THREAT EVIDENCE:
  // FORBID assigning combat types (uav, munition, bomb, fpv) solely based on speed, altitude, course, or kinematics!
  if (input.claimedType === "unknown" && !hasCombatEvidence) {
    const classEv = [...baseEvidence, "insufficient_threat_evidence", "kinematics_unconfirmed"];
    return {
      resolvedType: "unknown",
      resolvedModel: "Невідома повітряна ціль",
      confidence: Math.min(posConf, 0.40),
      positionConfidence: posConf,
      classConfidence: 0.35,
      classEvidence: classEv,
      threatEvidence: [],
      alternative: speedKmh > 350
        ? { type: "aircraft", model: "Літак (висока швидкість)", confidence: 0.35 }
        : { type: "unknown", model: "Повітряний об'єкт", confidence: 0.25 },
      evidence: classEv,
      propulsion: "unknown",
      isMeasuredSpeed,
      isMeasuredAltitude,
      speedKmh,
      estimatedAltitudeM: alt
    };
  }

  // 5. COMBAT TARGETS: Allowed when claimedType is combat OR independent sensor threat evidence is present
  const isCombatClaimed =
    input.claimedType === "uav" ||
    input.claimedType === "munition" ||
    input.claimedType === "bomb" ||
    input.claimedType === "fpv";

  if (hasCombatEvidence || isCombatClaimed) {
    // 5A. Cruise Missiles / Ballistics
    if (
      input.claimedType === "munition" ||
      threatEvidenceList.some(e => e.includes("missile") || e.includes("ballistic") || e.includes("cruise"))
    ) {
      if (speedKmh > 1200 || threatEvidenceList.some(e => e.includes("ballistic"))) {
        const classEv = [...baseEvidence, ...threatEvidenceList, "hyper_high_velocity_ballistic"];
        return {
          resolvedType: "munition",
          resolvedModel: input.modelHint || "Іскандер-М / Кинджал (Балістика)",
          confidence: Math.min(posConf, 0.94),
          positionConfidence: posConf,
          classConfidence: 0.94,
          classEvidence: classEv,
          threatEvidence: threatEvidenceList,
          alternative: {
            type: "munition",
            model: "Х-101 / Калібр (Крилата ракета)",
            confidence: 0.40
          },
          evidence: classEv,
          propulsion: "rocket",
          isMeasuredSpeed,
          isMeasuredAltitude,
          speedKmh,
          estimatedAltitudeM: alt
        };
      }

      const classEv = [...baseEvidence, ...threatEvidenceList, "terrain_hugging_transonic_cruise"];
      return {
        resolvedType: "munition",
        resolvedModel: input.modelHint || "Х-101 / Калібр (Крилата ракета)",
        confidence: Math.min(posConf, 0.92),
        positionConfidence: posConf,
        classConfidence: 0.92,
        classEvidence: classEv,
        threatEvidence: threatEvidenceList,
        alternative: {
          type: "uav",
          model: "Shahed-238 (Jet)",
          confidence: 0.55
        },
        evidence: classEv,
        propulsion: "turbojet",
        isMeasuredSpeed,
        isMeasuredAltitude,
        speedKmh,
        estimatedAltitudeM: alt
      };
    }

    // 5B. Guided Glide Bombs (KAB / UMPK)
    if (
      input.claimedType === "bomb" ||
      threatEvidenceList.some(e => e.includes("kab") || e.includes("glide") || e.includes("umpk"))
    ) {
      const classEv = [...baseEvidence, ...threatEvidenceList, "aerodynamic_glide_umpk"];
      return {
        resolvedType: "bomb",
        resolvedModel: input.modelHint || "КАБ-500 з УМПК",
        confidence: Math.min(posConf, 0.91),
        positionConfidence: posConf,
        classConfidence: 0.91,
        classEvidence: classEv,
        threatEvidence: threatEvidenceList,
        alternative: {
          type: "munition",
          model: "Х-59 / Х-69 (Крилата ракета)",
          confidence: 0.48
        },
        evidence: classEv,
        propulsion: "glide",
        isMeasuredSpeed,
        isMeasuredAltitude,
        speedKmh,
        estimatedAltitudeM: alt
      };
    }

    // 5C. FPV Strike Quads
    if (
      input.claimedType === "fpv" ||
      threatEvidenceList.some(e => e.includes("fpv") || e.includes("quad"))
    ) {
      const classEv = [...baseEvidence, ...threatEvidenceList, "rotary_quad_low_level"];
      return {
        resolvedType: "fpv",
        resolvedModel: input.modelHint || "FPV-дрон (Ударний квадрокоптер)",
        confidence: Math.min(posConf, 0.90),
        positionConfidence: posConf,
        classConfidence: 0.90,
        classEvidence: classEv,
        threatEvidence: threatEvidenceList,
        alternative: {
          type: "uav",
          model: "Малий розвідувальний БПЛА (Mavic/Autel)",
          confidence: 0.45
        },
        evidence: classEv,
        propulsion: "electric",
        isMeasuredSpeed,
        isMeasuredAltitude,
        speedKmh,
        estimatedAltitudeM: alt
      };
    }

    // 5D. UAV (Shahed-238, Shahed-136, Recon)
    if (
      input.claimedType === "uav" ||
      threatEvidenceList.some(e => e.includes("shahed") || e.includes("uav") || e.includes("acoustic") || e.includes("optical"))
    ) {
      const hintLower = (input.modelHint || "").toLowerCase();
      const hasJetHint =
        hintLower.includes("238") ||
        hintLower.includes("jet") ||
        hintLower.includes("реактив") ||
        hintLower.includes("турбореактив") ||
        threatEvidenceList.some(e => e.includes("turbojet") || e.includes("jet"));

      const hasReconHint =
        hintLower.includes("supercam") ||
        hintLower.includes("orlan") ||
        hintLower.includes("zala") ||
        hintLower.includes("розвід") ||
        hintLower.includes("shark");

      // Reconnaissance UAV
      if ((speedKmh < 135 && !hasJetHint) || hasReconHint) {
        const classEv = [...baseEvidence, ...threatEvidenceList, "loitering_recon_velocity"];
        return {
          resolvedType: "uav",
          resolvedModel: input.modelHint || "Supercam S350 Recon",
          confidence: Math.min(posConf, 0.92),
          positionConfidence: posConf,
          classConfidence: 0.92,
          classEvidence: classEv,
          threatEvidence: threatEvidenceList,
          alternative: {
            type: "uav",
            model: "Shahed-136 (уповільнений політ)",
            confidence: 0.38
          },
          evidence: classEv,
          propulsion: "electric",
          isMeasuredSpeed,
          isMeasuredAltitude,
          speedKmh,
          estimatedAltitudeM: alt
        };
      }

      // Turbojet Shahed-238
      const isHighAltitude = alt > 600;
      if (speedKmh >= 310 || (hasJetHint && speedKmh >= 215) || (speedKmh >= 235 && isHighAltitude)) {
        const classEv = [...baseEvidence, ...threatEvidenceList, "turbojet_toloue_10_speed_profile"];
        return {
          resolvedType: "uav",
          resolvedModel: "Shahed-238 (Jet)",
          confidence: Math.min(posConf, 0.94),
          positionConfidence: posConf,
          classConfidence: 0.94,
          classEvidence: classEv,
          threatEvidence: threatEvidenceList,
          alternative: speedKmh > 500
            ? { type: "munition", model: "Х-101 / Калібр (Крилата ракета)", confidence: 0.60 }
            : { type: "uav", model: "Shahed-136 (пікірування)", confidence: 0.35 },
          evidence: classEv,
          propulsion: "turbojet",
          isMeasuredSpeed,
          isMeasuredAltitude,
          speedKmh,
          estimatedAltitudeM: alt
        };
      }

      // Transitional speed band hysteresis (Shahed-136 diving / tailwind)
      if (speedKmh >= 215 && speedKmh < 310) {
        const classEv = [...baseEvidence, ...threatEvidenceList, "transitional_speed_band"];
        return {
          resolvedType: "uav",
          resolvedModel: "Shahed-136",
          confidence: Math.min(posConf, 0.78),
          positionConfidence: posConf,
          classConfidence: 0.78,
          classEvidence: classEv,
          threatEvidence: threatEvidenceList,
          alternative: {
            type: "uav",
            model: "Shahed-238 (Jet)",
            confidence: 0.65
          },
          evidence: classEv,
          propulsion: "piston",
          isMeasuredSpeed,
          isMeasuredAltitude,
          speedKmh,
          estimatedAltitudeM: alt
        };
      }

      // Standard Piston Shahed-136 with sensor evidence
      const classEv = [...baseEvidence, ...threatEvidenceList, "md550_piston_propeller_velocity"];
      return {
        resolvedType: "uav",
        resolvedModel: "Shahed-136",
        confidence: Math.min(posConf, 0.95),
        positionConfidence: posConf,
        classConfidence: 0.95,
        classEvidence: classEv,
        threatEvidence: threatEvidenceList,
        alternative: {
          type: "uav",
          model: "Shahed-238 (Jet)",
          confidence: 0.25
        },
        evidence: classEv,
        propulsion: "piston",
        isMeasuredSpeed,
        isMeasuredAltitude,
        speedKmh,
        estimatedAltitudeM: alt
      };
    }
  }

  // 6. Default Fallback UNKNOWN
  const classEv = [...baseEvidence, "unconfirmed_observation"];
  return {
    resolvedType: "unknown",
    resolvedModel: "Невідома повітряна ціль",
    confidence: Math.min(posConf, 0.40),
    positionConfidence: posConf,
    classConfidence: 0.35,
    classEvidence: classEv,
    threatEvidence: [],
    alternative: { type: "unknown", model: "Повітряний об'єкт", confidence: 0.25 },
    evidence: classEv,
    propulsion: "unknown",
    isMeasuredSpeed,
    isMeasuredAltitude,
    speedKmh,
    estimatedAltitudeM: alt
  };
}
