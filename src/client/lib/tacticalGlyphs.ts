// src/client/lib/tacticalGlyphs.ts
// Realistic freestanding aerodynamic silhouettes with forward direction vectors.
// No dark circular button backgrounds; clean aerospace geometry rotated to flight heading.

export interface GlyphRenderOptions {
  size: number;
  rotationDeg: number;
  type: string;
  color: string;
  isSelected?: boolean;
  model?: string;
  speedKmh?: number;
  isLowTier?: boolean;
  confidence?: number;
  timeMs?: number;
  hasDirection?: boolean;
  isSensor?: boolean;
}

/**
 * Renders a realistic freestanding aerial target silhouette at (0, 0) oriented along -Y (0 deg).
 * Includes a forward velocity/direction vector arrow and an on-selection reticle.
 */
export function renderTacticalGlyph(
  ctx: CanvasRenderingContext2D,
  options: GlyphRenderOptions
): void {
  const {
    size,
    type,
    color,
    isSelected = false,
    model = "",
    speedKmh = 0,
    isLowTier = false,
    timeMs = 0,
    hasDirection = true
  } = options;

  ctx.save();

  const s = Math.max(11, Math.min(20, size * 0.68));
  const showVector = hasDirection || speedKmh > 0;

  // 1. Forward direction vector line + arrowhead (shows real-time direction of movement)
  if (showVector) {
    const vecLen = Math.min(34, Math.max(18, s * 1.45 + (speedKmh > 300 ? 8 : 3)));
    const noseY = -s * 0.85;
    const tipY = noseY - vecLen;

    ctx.save();
    const grad = ctx.createLinearGradient(0, noseY, 0, tipY);
    grad.addColorStop(0, color);
    grad.addColorStop(1, `${color}44`);
    ctx.strokeStyle = isSelected ? "#ffffff" : grad;
    ctx.lineWidth = isSelected ? 1.8 : 1.35;
    ctx.beginPath();
    ctx.moveTo(0, noseY);
    ctx.lineTo(0, tipY);
    ctx.stroke();

    // Crisp directional arrowhead at tipY
    ctx.fillStyle = isSelected ? "#ffffff" : color;
    ctx.beginPath();
    ctx.moveTo(0, tipY - 3.5);
    ctx.lineTo(3.2, tipY + 2.5);
    ctx.lineTo(0, tipY + 0.8);
    ctx.lineTo(-3.2, tipY + 2.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 2. Selection lock ring ONLY when the user clicked/selected this target
  if (isSelected) {
    const pulse = 0.5 + 0.5 * Math.sin(timeMs / 240);
    const ringR = s * 1.25 + pulse * 2.5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 3. Soft drop shadow so the freestanding silhouette stands out against both Day and Night satellite terrain
  if (!isLowTier) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.88)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1.5;
  }

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (type === "aircraft") {
    const isAwacs = /E-3|SENTRY|AWACS/i.test(model);
    // Swept-wing jet aircraft silhouette
    ctx.fillStyle = color;
    ctx.strokeStyle = isSelected ? "#ffffff" : "#0f172a";
    ctx.lineWidth = 1.1;

    ctx.beginPath();
    ctx.moveTo(0, -s * 0.98); // Nose
    ctx.lineTo(s * 0.14, -s * 0.52);
    ctx.lineTo(s * 0.92, s * 0.10); // Right wingtip leading
    ctx.lineTo(s * 0.92, s * 0.28); // Right wingtip trailing
    ctx.lineTo(s * 0.16, s * 0.06);
    ctx.lineTo(s * 0.13, s * 0.58);
    ctx.lineTo(s * 0.46, s * 0.82); // Right tailplane
    ctx.lineTo(s * 0.46, s * 0.95);
    ctx.lineTo(0, s * 0.78);
    ctx.lineTo(-s * 0.46, s * 0.95); // Left tailplane
    ctx.lineTo(-s * 0.46, s * 0.82);
    ctx.lineTo(-s * 0.13, s * 0.58);
    ctx.lineTo(-s * 0.16, s * 0.06);
    ctx.lineTo(-s * 0.92, s * 0.28); // Left wingtip trailing
    ctx.lineTo(-s * 0.92, s * 0.10); // Left wingtip leading
    ctx.lineTo(-s * 0.14, -s * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cockpit canopy highlight
    ctx.fillStyle = "#e0f2fe";
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.52, s * 0.07, s * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    // AWACS dorsal rotodome radar disc (for E-3A Sentry)
    if (isAwacs) {
      ctx.fillStyle = "#0f172a";
      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(0, s * 0.18, s * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#38bdf8";
      ctx.beginPath();
      ctx.moveTo(-s * 0.24, s * 0.18);
      ctx.lineTo(s * 0.24, s * 0.18);
      ctx.stroke();
    }
  } else if (type === "munition") {
    // Sleek cruise/ballistic missile silhouette with thruster flame
    ctx.fillStyle = "#f97316";
    ctx.strokeStyle = isSelected ? "#ffffff" : "#431407";
    ctx.lineWidth = 1.1;

    ctx.beginPath();
    ctx.moveTo(0, -s * 1.02); // Pointed warhead nose
    ctx.lineTo(s * 0.16, -s * 0.56);
    ctx.lineTo(s * 0.16, -s * 0.10);
    ctx.lineTo(s * 0.72, s * 0.22); // Swept cruise wing
    ctx.lineTo(s * 0.72, s * 0.38);
    ctx.lineTo(s * 0.16, s * 0.20);
    ctx.lineTo(s * 0.15, s * 0.68);
    ctx.lineTo(s * 0.42, s * 0.88); // Tail fin
    ctx.lineTo(s * 0.42, s * 0.98);
    ctx.lineTo(0, s * 0.84);
    ctx.lineTo(-s * 0.42, s * 0.98);
    ctx.lineTo(-s * 0.42, s * 0.88);
    ctx.lineTo(-s * 0.15, s * 0.68);
    ctx.lineTo(-s * 0.16, s * 0.20);
    ctx.lineTo(-s * 0.72, s * 0.38);
    ctx.lineTo(-s * 0.72, s * 0.22);
    ctx.lineTo(-s * 0.16, -s * 0.10);
    ctx.lineTo(-s * 0.16, -s * 0.56);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Exhaust glow
    ctx.fillStyle = "#fef08a";
    ctx.beginPath();
    ctx.arc(0, s * 0.92, s * 0.13, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === "bomb") {
    // Guided glide bomb (КАБ / УМПК) with deployed glide wings
    ctx.fillStyle = "#f59e0b";
    ctx.strokeStyle = isSelected ? "#ffffff" : "#451a03";
    ctx.lineWidth = 1.1;

    ctx.beginPath();
    ctx.moveTo(0, -s * 0.88);
    ctx.lineTo(s * 0.22, -s * 0.46);
    ctx.lineTo(s * 0.22, -s * 0.12);
    ctx.lineTo(s * 0.78, s * 0.10); // Pop-out UMPK wing
    ctx.lineTo(s * 0.78, s * 0.26);
    ctx.lineTo(s * 0.20, s * 0.14);
    ctx.lineTo(s * 0.18, s * 0.62);
    ctx.lineTo(s * 0.40, s * 0.82);
    ctx.lineTo(-s * 0.40, s * 0.82);
    ctx.lineTo(-s * 0.18, s * 0.62);
    ctx.lineTo(-s * 0.20, s * 0.14);
    ctx.lineTo(-s * 0.78, s * 0.26);
    ctx.lineTo(-s * 0.78, s * 0.10);
    ctx.lineTo(-s * 0.22, -s * 0.12);
    ctx.lineTo(-s * 0.22, -s * 0.46);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (type === "fpv") {
    // 4-rotor tactical FPV quadcopter
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, -s * 0.55);
    ctx.lineTo(s * 0.55, s * 0.55);
    ctx.moveTo(s * 0.55, -s * 0.55);
    ctx.lineTo(-s * 0.55, s * 0.55);
    ctx.stroke();

    ctx.fillStyle = "rgba(168, 85, 247, 0.45)";
    ctx.strokeStyle = "#f3e8ff";
    ctx.lineWidth = 1.0;
    for (const [rx, ry] of [
      [-s * 0.55, -s * 0.55],
      [s * 0.55, -s * 0.55],
      [-s * 0.55, s * 0.55],
      [s * 0.55, s * 0.55]
    ]) {
      ctx.beginPath();
      ctx.arc(rx, ry, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (type === "helicopter") {
    // Helicopter body + tail boom + rotor blades
    ctx.fillStyle = "#10b981";
    ctx.strokeStyle = isSelected ? "#ffffff" : "#064e3b";
    ctx.lineWidth = 1.1;

    ctx.beginPath();
    ctx.ellipse(0, -s * 0.12, s * 0.28, s * 0.50, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-s * 0.08, s * 0.35);
    ctx.lineTo(s * 0.08, s * 0.35);
    ctx.lineTo(s * 0.05, s * 0.88);
    ctx.lineTo(-s * 0.05, s * 0.88);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Animated rotor blades
    const rotAngle = ((timeMs / 9) % 360) * (Math.PI / 180);
    ctx.save();
    ctx.translate(0, -s * 0.12);
    ctx.rotate(rotAngle);
    ctx.strokeStyle = "#ecfdf5";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-s * 0.78, 0);
    ctx.lineTo(s * 0.78, 0);
    ctx.moveTo(0, -s * 0.78);
    ctx.lineTo(0, s * 0.78);
    ctx.stroke();
    ctx.restore();
  } else {
    // Default / UAV: Realistic Shahed-136 / Geran-2 delta-wing strike drone silhouette
    ctx.fillStyle = color;
    ctx.strokeStyle = isSelected ? "#ffffff" : "#450a0a";
    ctx.lineWidth = 1.15;

    ctx.beginPath();
    ctx.moveTo(0, -s * 0.92); // Pointed nose cone
    ctx.lineTo(s * 0.16, -s * 0.42);
    ctx.lineTo(s * 0.78, s * 0.45); // Delta wingtip leading edge
    ctx.lineTo(s * 0.78, s * 0.66); // Wingtip stabilizer fin
    ctx.lineTo(s * 0.20, s * 0.46);
    ctx.lineTo(0, s * 0.64); // Rear pusher motor housing
    ctx.lineTo(-s * 0.20, s * 0.46);
    ctx.lineTo(-s * 0.78, s * 0.66);
    ctx.lineTo(-s * 0.78, s * 0.45);
    ctx.lineTo(-s * 0.16, -s * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Fuselage spine highlight
    ctx.strokeStyle = "#fecaca";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.72);
    ctx.lineTo(0, s * 0.46);
    ctx.stroke();
  }

  ctx.restore();
}
