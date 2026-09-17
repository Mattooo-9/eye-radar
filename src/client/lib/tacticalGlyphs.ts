// src/client/lib/tacticalGlyphs.ts
/**
 * High-precision, aerospace-grade tactical glyph renderer for Eye Radar.
 * Replaces primitive sticks, arrows, and cheap wireframes with clean,
 * realistic vector silhouettes, integrated heading markers, and visual threat hierarchy.
 */

export interface GlyphRenderOptions {
  size: number;
  rotationDeg: number;
  type: string;
  threatLevel?: string;
  color: string;
  isSelected: boolean;
  model?: string;
  speedKmh?: number;
  isLowTier?: boolean;
  confidence?: number;
  timeMs?: number;
}


/**
 * Draws an aerospace-grade tactical glyph centered at (0, 0) in the local coordinate space.
 * Assumes caller has already translated to (x, y) and rotated by rotationDeg.
 */
export function renderTacticalGlyph(
  ctx: CanvasRenderingContext2D,
  opts: GlyphRenderOptions
): void {
  const { size, type, color, isSelected, model, isLowTier } = opts;

  const isCombatJet = Boolean(
    model?.toLowerCase().includes("f-16") ||
    model?.toLowerCase().includes("su-") ||
    model?.toLowerCase().includes("mig-") ||
    model?.toLowerCase().includes("fighter") ||
    model?.toLowerCase().includes("bomber") ||
    model?.toLowerCase().includes("flanker") ||
    model?.toLowerCase().includes("fulcrum") ||
    model?.toLowerCase().includes("combat")
  );

  // 1. Soft Ambient Halo (threat / status hierarchy)
  if (!isLowTier) {
    const haloRadius = isSelected ? size * 1.8 : size * 1.35;
    const gradient = ctx.createRadialGradient(0, 0, size * 0.3, 0, 0, haloRadius);
    if (color === "#ef4444" || color === "#dc2626") {
      gradient.addColorStop(0, "rgba(239, 68, 68, 0.28)");
      gradient.addColorStop(0.5, "rgba(239, 68, 68, 0.10)");
      gradient.addColorStop(1, "rgba(239, 68, 68, 0.0)");
    } else if (color === "#f59e0b" || color === "#f97316") {
      gradient.addColorStop(0, "rgba(245, 158, 11, 0.22)");
      gradient.addColorStop(0.5, "rgba(245, 158, 11, 0.08)");
      gradient.addColorStop(1, "rgba(245, 158, 11, 0.0)");
    } else {
      gradient.addColorStop(0, "rgba(56, 189, 248, 0.28)");
      gradient.addColorStop(0.5, "rgba(56, 189, 248, 0.10)");
      gradient.addColorStop(1, "rgba(56, 189, 248, 0.0)");
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Class-specific Vector Silhouette
  const isShahedJet = Boolean(model?.toLowerCase().includes("238") || model?.toLowerCase().includes("jet"));
  const isReconUav = Boolean(
    model?.toLowerCase().includes("recon") ||
    model?.toLowerCase().includes("supercam") ||
    model?.toLowerCase().includes("orlan") ||
    model?.toLowerCase().includes("zala")
  );

  if (type === "uav") {
    if (isReconUav) {
      drawReconUavGlyph(ctx, size, color);
    } else if (isShahedJet) {
      drawShahed238JetGlyph(ctx, size, color);
    } else {
      drawShahed136DeltaGlyph(ctx, size, color);
    }
  } else if (type === "munition") {
    drawCruiseMissileGlyph(ctx, size, color);
  } else if (type === "bomb") {
    drawGlideBombGlyph(ctx, size, color);
  } else if (type === "helicopter") {
    drawHelicopterGlyph(ctx, size, color);
  } else if (type === "fpv") {
    drawFpvDroneGlyph(ctx, size, color);
  } else if (type === "aircraft") {
    if (isCombatJet) {
      drawFastJetGlyph(ctx, size, color);
    } else {
      drawCivilianAirlinerGlyph(ctx, size, color || "#38bdf8");
    }
  } else {
    drawUnknownTargetGlyph(ctx, size, color);
  }

  // 3. Tactical Selection Reticle (corner brackets, no ugly bounding boxes)
  if (isSelected) {
    drawSelectionReticle(ctx, size, color);
  }
}

/**
 * Shahed-136 / Delta Kamikaze UAV
 * Iconic cropped delta with blended wing-body and integrated nose beacon
 */
function drawShahed136DeltaGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  accentColor: string
): void {
  // Main blended delta wing
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.05); // Nose apex
  ctx.lineTo(size * 0.82, size * 0.48); // Right wingtip
  ctx.lineTo(size * 0.82, size * 0.62); // Winglet outer
  ctx.lineTo(size * 0.68, size * 0.62); // Winglet inner
  ctx.lineTo(size * 0.18, size * 0.42); // Inboard trailing edge
  ctx.lineTo(size * 0.12, size * 0.52); // Pusher engine nacelle
  ctx.lineTo(-size * 0.12, size * 0.52);
  ctx.lineTo(-size * 0.18, size * 0.42);
  ctx.lineTo(-size * 0.68, size * 0.62);
  ctx.lineTo(-size * 0.82, size * 0.62);
  ctx.lineTo(-size * 0.82, size * 0.48);
  ctx.closePath();

  // Dark matte radar-absorbing composite fill
  ctx.fillStyle = "#090d16";
  ctx.fill();

  // Crisp tactical perimeter bevel
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Spine / central avionics bay
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.15, size * 0.12, size * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Winglet vertical stabilizers
  ctx.fillStyle = accentColor;
  ctx.fillRect(-size * 0.82, size * 0.42, 2.2, size * 0.20);
  ctx.fillRect(size * 0.82 - 2.2, size * 0.42, 2.2, size * 0.20);

  // Integrated Forward Directional Apex (Focal guidance pip)
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -size * 0.96, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // Micro propulsion core indicator at the rear
  ctx.fillStyle = "rgba(249, 115, 22, 0.85)";
  ctx.beginPath();
  ctx.arc(0, size * 0.52, 1.4, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Shahed-238 Turbojet Delta
 * Stealth matte jet silhouette with intake apertures and nozzle glow
 */
function drawShahed238JetGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  accentColor: string
): void {
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.10);
  ctx.lineTo(size * 0.85, size * 0.50);
  ctx.lineTo(size * 0.85, size * 0.65);
  ctx.lineTo(size * 0.65, size * 0.65);
  ctx.lineTo(size * 0.15, size * 0.46);
  ctx.lineTo(0, size * 0.54);
  ctx.lineTo(-size * 0.15, size * 0.46);
  ctx.lineTo(-size * 0.65, size * 0.65);
  ctx.lineTo(-size * 0.85, size * 0.65);
  ctx.lineTo(-size * 0.85, size * 0.50);
  ctx.closePath();

  ctx.fillStyle = "#05070c";
  ctx.fill();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Dorsal turbojet air intake
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.ellipse(0, size * 0.05, size * 0.10, size * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sharp forward nose tracker
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -size * 1.02, 2.0, 0, Math.PI * 2);
  ctx.fill();

  // High-heat turbine exhaust glint
  ctx.fillStyle = "#f97316";
  ctx.beginPath();
  ctx.arc(0, size * 0.54, 2.0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Reconnaissance ISR UAV (Orlan-10, Supercam S350, ZALA)
 * High-aspect straight wings with forward pod and V-tail
 */
function drawReconUavGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  accentColor: string
): void {
  // Fuselage pod
  ctx.fillStyle = "#0c1322";
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.10, size * 0.12, size * 0.58, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // High-aspect planar wings
  ctx.fillStyle = "#111c30";
  ctx.beginPath();
  ctx.rect(-size * 1.15, -size * 0.08, size * 2.30, size * 0.16);
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // V-tail
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-size * 0.32, size * 0.52);
  ctx.lineTo(0, size * 0.40);
  ctx.lineTo(size * 0.32, size * 0.52);
  ctx.stroke();

  // EO/IR Gimbal ball under nose
  ctx.fillStyle = "#38bdf8";
  ctx.beginPath();
  ctx.arc(0, -size * 0.60, 2.4, 0, Math.PI * 2);
  ctx.fill();

  // Forward nose orientation pip
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -size * 0.70, 1.4, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Cruise Missile (Kh-101, Kalibr, Iskander-K)
 * Slender supersonic missile body with cruciform canards and tail fins
 */
function drawCruiseMissileGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  accentColor: string
): void {
  // Cylindrical body with conical nose
  ctx.fillStyle = "#090d16";
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.35); // Sharp needle nose
  ctx.lineTo(size * 0.14, -size * 0.90);
  ctx.lineTo(size * 0.14, size * 0.75);
  ctx.lineTo(0, size * 0.85); // Tail nozzle
  ctx.lineTo(-size * 0.14, size * 0.75);
  ctx.lineTo(-size * 0.14, -size * 0.90);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Forward deployable planar wings / canards
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.moveTo(-size * 0.80, -size * 0.10);
  ctx.lineTo(size * 0.80, -size * 0.10);
  ctx.lineTo(size * 0.70, 0);
  ctx.lineTo(-size * 0.70, 0);
  ctx.closePath();
  ctx.fill();

  // Cruciform tail fins
  ctx.beginPath();
  ctx.moveTo(-size * 0.45, size * 0.65);
  ctx.lineTo(size * 0.45, size * 0.65);
  ctx.lineTo(size * 0.38, size * 0.75);
  ctx.lineTo(-size * 0.38, size * 0.75);
  ctx.closePath();
  ctx.fill();

  // Terminal optical/radar seeker lens in nose
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -size * 1.25, 2.0, 0, Math.PI * 2);
  ctx.fill();

  // Rocket / Turbofan motor thrust nozzle
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.ellipse(0, size * 0.82, size * 0.08, size * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Glide Bomb (KAB-500, UMPK module)
 * Heavy precision bomb cylinder with wide planar wings
 */
function drawGlideBombGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  accentColor: string
): void {
  // Bomb body
  ctx.fillStyle = "#0c1322";
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.18, size * 0.65, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Folding UMPK glide wing
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.moveTo(-size * 1.05, -size * 0.15);
  ctx.lineTo(size * 1.05, -size * 0.15);
  ctx.lineTo(size * 0.95, -size * 0.02);
  ctx.lineTo(-size * 0.95, -size * 0.02);
  ctx.closePath();
  ctx.fill();

  // Tail stabilization fins
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-size * 0.35, size * 0.55);
  ctx.lineTo(size * 0.35, size * 0.55);
  ctx.stroke();

  // Nose fuse point
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -size * 0.65, 1.8, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Fast Jet / Tactical Fighter (Su-27, MiG-29, F-16)
 * Cropped double-delta, LERX and twin vertical stabilizers
 */
function drawFastJetGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  accentColor: string
): void {
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.25); // Nose radome
  ctx.lineTo(size * 0.15, -size * 0.50); // LERX
  ctx.lineTo(size * 0.95, size * 0.18); // Right wingtip
  ctx.lineTo(size * 0.95, size * 0.28);
  ctx.lineTo(size * 0.32, size * 0.40); // Wing trailing edge
  ctx.lineTo(size * 0.30, size * 0.70); // Right horizontal stabilizer
  ctx.lineTo(size * 0.14, size * 0.65);
  ctx.lineTo(0, size * 0.58); // Tail sting
  ctx.lineTo(-size * 0.14, size * 0.65);
  ctx.lineTo(-size * 0.30, size * 0.70);
  ctx.lineTo(-size * 0.32, size * 0.40);
  ctx.lineTo(-size * 0.95, size * 0.28);
  ctx.lineTo(-size * 0.95, size * 0.18);
  ctx.lineTo(-size * 0.15, -size * 0.50);
  ctx.closePath();

  ctx.fillStyle = "#0c1424";
  ctx.fill();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Cockpit canopy glint
  ctx.fillStyle = "rgba(56, 189, 248, 0.75)";
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.45, size * 0.08, size * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Twin tail fins
  ctx.fillStyle = accentColor;
  ctx.fillRect(-size * 0.22, size * 0.30, 2.0, size * 0.28);
  ctx.fillRect(size * 0.22 - 2.0, size * 0.30, 2.0, size * 0.28);

  // Forward nose orientation indicator
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -size * 1.18, 1.8, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Tactical Helicopter (Mi-8, Mi-24, Ka-52)
 * Cabin body, tail boom, rotor disk and tail fin
 */
function drawHelicopterGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  accentColor: string
): void {
  // Main rotor disk perimeter (clean tactical ring)
  ctx.strokeStyle = "rgba(56, 189, 248, 0.30)";
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.arc(0, -size * 0.05, size * 0.95, 0, Math.PI * 2);
  ctx.stroke();

  // Cabin fuselage
  ctx.fillStyle = "#0c1424";
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.65);
  ctx.quadraticCurveTo(size * 0.24, -size * 0.20, size * 0.18, size * 0.20);
  ctx.lineTo(size * 0.06, size * 0.85); // Tail boom
  ctx.lineTo(-size * 0.06, size * 0.85);
  ctx.lineTo(-size * 0.18, size * 0.20);
  ctx.quadraticCurveTo(-size * 0.24, -size * 0.20, 0, -size * 0.65);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Rotor mast hub
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(0, -size * 0.05, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Tail rotor
  ctx.fillStyle = accentColor;
  ctx.fillRect(size * 0.06, size * 0.72, size * 0.20, 1.8);

  // Cockpit glass
  ctx.fillStyle = "#38bdf8";
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.45, size * 0.12, size * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Forward nose pip
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -size * 0.60, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Tactical FPV / Micro-Quad Drone
 * Clean X-frame chassis with 4 motor discs
 */
function drawFpvDroneGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  accentColor: string
): void {
  // X-frame carbon arms
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-size * 0.65, -size * 0.65);
  ctx.lineTo(size * 0.65, size * 0.65);
  ctx.moveTo(size * 0.65, -size * 0.65);
  ctx.lineTo(-size * 0.65, size * 0.65);
  ctx.stroke();

  // 4 Propeller motor disc rings
  ctx.fillStyle = "#090d16";
  const armOffset = size * 0.65;
  const motorPositions = [
    [-armOffset, -armOffset],
    [armOffset, -armOffset],
    [-armOffset, armOffset],
    [armOffset, armOffset]
  ];

  for (const [mx, my] of motorPositions) {
    ctx.beginPath();
    ctx.arc(mx, my, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.0;
    ctx.stroke();
  }

  // Central flight controller & battery pod
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(-size * 0.20, -size * 0.28, size * 0.40, size * 0.56);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 0.8;
  ctx.strokeRect(-size * 0.20, -size * 0.28, size * 0.40, size * 0.56);

  // Forward camera orientation marker
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(0, -size * 0.32, 2.0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Civilian Airliner (Boeing / Airbus / Embraer / Regional Jet)
 * Muted non-threat passenger silhouette: slender fuselage, swept wings, twin underwing turbofans, cruciform tail.
 */
function drawCivilianAirlinerGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  accentColor: string
): void {
  ctx.save();
  const strokeColor = accentColor || "#38bdf8";

  // Forward Heading Velocity Vector (indicates flight trajectory)
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.15);
  ctx.lineTo(0, -size * 1.95);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Directional arrowhead on vector tip
  ctx.beginPath();
  ctx.moveTo(-size * 0.22, -size * 1.70);
  ctx.lineTo(0, -size * 1.98);
  ctx.lineTo(size * 0.22, -size * 1.70);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Fuselage (slender rounded passenger cabin)
  ctx.fillStyle = "rgba(15, 23, 42, 0.92)"; // Dark navy slate with high contrast against map
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.18, size * 1.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Swept Main Wings
  ctx.fillStyle = "rgba(30, 41, 59, 0.95)";
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.25);
  ctx.lineTo(size * 1.25, size * 0.28); // Right wingtip
  ctx.lineTo(size * 1.18, size * 0.44);
  ctx.lineTo(size * 0.18, size * 0.18); // Inboard root
  ctx.lineTo(-size * 0.18, size * 0.18); // Inboard left root
  ctx.lineTo(-size * 1.18, size * 0.44);
  ctx.lineTo(-size * 1.25, size * 0.28); // Left wingtip
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Under-wing turbofan engines
  ctx.fillStyle = strokeColor;
  ctx.fillRect(size * 0.42, -size * 0.05, size * 0.12, size * 0.28);
  ctx.fillRect(-size * 0.54, -size * 0.05, size * 0.12, size * 0.28);

  // Horizontal Tailplane
  ctx.fillStyle = "rgba(30, 41, 59, 0.95)";
  ctx.beginPath();
  ctx.moveTo(0, size * 0.82);
  ctx.lineTo(size * 0.52, size * 1.08);
  ctx.lineTo(size * 0.46, size * 1.18);
  ctx.lineTo(0, size * 1.05);
  ctx.lineTo(-size * 0.46, size * 1.18);
  ctx.lineTo(-size * 0.52, size * 1.08);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Forward nose radome pip (bright tactical dot)
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -size * 1.12, 2.0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Unknown / Generic Aerial Contact
 * Precision tactical diamond with directional apex and ? indicator
 */
function drawUnknownTargetGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  accentColor: string
): void {
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.0); // Forward apex
  ctx.lineTo(size * 0.60, 0);
  ctx.lineTo(0, size * 0.60);
  ctx.lineTo(-size * 0.60, 0);
  ctx.closePath();

  ctx.fillStyle = "#0c1424";
  ctx.fill();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Center tactical unknown question mark indicator
  ctx.fillStyle = accentColor;
  ctx.font = `bold ${Math.round(size * 0.75)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", 0, 1);

  // Forward apex dot
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -size * 0.90, 1.8, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Precision tactical selection reticle (4 subtle corner brackets)
 */
function drawSelectionReticle(
  ctx: CanvasRenderingContext2D,
  size: number,
  accentColor: string
): void {
  const r = size * 1.45;
  const arm = size * 0.35;

  ctx.save();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.6;

  // 4 Corner Brackets: Top-Left, Top-Right, Bottom-Right, Bottom-Left
  // Top-Left
  ctx.beginPath();
  ctx.moveTo(-r, -r + arm);
  ctx.lineTo(-r, -r);
  ctx.lineTo(-r + arm, -r);
  ctx.stroke();

  // Top-Right
  ctx.beginPath();
  ctx.moveTo(r - arm, -r);
  ctx.lineTo(r, -r);
  ctx.lineTo(r, -r + arm);
  ctx.stroke();

  // Bottom-Right
  ctx.beginPath();
  ctx.moveTo(r, r - arm);
  ctx.lineTo(r, r);
  ctx.lineTo(r - arm, r);
  ctx.stroke();

  // Bottom-Left
  ctx.beginPath();
  ctx.moveTo(-r + arm, r);
  ctx.lineTo(-r, r);
  ctx.lineTo(-r, r - arm);
  ctx.stroke();

  ctx.restore();
}
