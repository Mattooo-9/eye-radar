export interface WindVector {
  speedMs: number;
  directionDeg: number; // Meteorological: direction FROM which wind blows
}

export interface AerodynamicCheck {
  valid: boolean;
  indicatedAirspeedKmh: number;
  apparentCrosswindKmh: number;
  flags: string[];
  suggestedType?: string;
}

/**
 * Validates target ground kinematics against regional atmospheric wind vector
 */
export function validateAerodynamics(
  groundSpeedMs: number,
  groundHeadingDeg: number,
  wind: WindVector | null,
  claimedType: string
): AerodynamicCheck {
  const flags: string[] = [];
  const groundSpeedKmh = groundSpeedMs * 3.6;

  if (!wind || wind.speedMs <= 0.5) {
    return {
      valid: true,
      indicatedAirspeedKmh: Math.round(groundSpeedKmh),
      apparentCrosswindKmh: 0,
      flags: []
    };
  }

  // Wind vector towards which air moves
  const windTowardRad = ((wind.directionDeg + 180) % 360) * (Math.PI / 180);
  const windVx = wind.speedMs * Math.sin(windTowardRad);
  const windVy = wind.speedMs * Math.cos(windTowardRad);

  // Target ground velocity vector
  const headingRad = groundHeadingDeg * (Math.PI / 180);
  const groundVx = groundSpeedMs * Math.sin(headingRad);
  const groundVy = groundSpeedMs * Math.cos(headingRad);

  // True Airspeed vector = Ground Velocity - Wind Velocity
  const airVx = groundVx - windVx;
  const airVy = groundVy - windVy;
  const airSpeedMs = Math.hypot(airVx, airVy);
  const airSpeedKmh = airSpeedMs * 3.6;

  // Crosswind component
  const relAngle = Math.abs(groundHeadingDeg - ((wind.directionDeg + 180) % 360)) * (Math.PI / 180);
  const crosswindKmh = wind.speedMs * 3.6 * Math.sin(relAngle);

  // Aerodynamic checks:
  if (claimedType === "uav" || claimedType === "Shahed-136") {
    // Shahed-136 MD-550 piston engine maximum level flight airspeed is ~210 km/h
    if (airSpeedKmh > 235) {
      flags.push("airspeed_exceeds_piston_limit");
      return {
        valid: true,
        indicatedAirspeedKmh: Math.round(airSpeedKmh),
        apparentCrosswindKmh: Math.round(crosswindKmh),
        flags,
        suggestedType: "Shahed-238 (Jet)"
      };
    }

    // Minimum flying speed before aerodynamic stall for delta wing Shahed is ~105 km/h
    if (airSpeedKmh < 90 && groundSpeedKmh > 20) {
      flags.push("airspeed_below_stall_speed");
    }
  }

  if (claimedType === "bomb") {
    // Glide bombs (KAB with UMPK) must maintain high forward glide speed
    if (airSpeedKmh < 280) {
      flags.push("sub_glide_velocity");
    }
  }

  return {
    valid: flags.length === 0,
    indicatedAirspeedKmh: Math.round(airSpeedKmh),
    apparentCrosswindKmh: Math.round(crosswindKmh),
    flags
  };
}
