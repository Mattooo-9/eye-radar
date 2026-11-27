// src/client/lib/tacticalGlyphs.ts
// Precision vector cartographic silhouettes for aerial targets & threat sectors.
// High-contrast, clean vector geometry (no pixelated bitmaps, no visual clutter).

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
 * Renders a high-contrast vector tactical marker at (0, 0).
 * Note: The caller applies canvas translation and rotation before calling when directional.
 */
export function renderTacticalGlyph(
  ctx: CanvasRenderingContext2D,
  options: GlyphRenderOptions
): void {
  const {
    type,
    color,
    isSelected = false,
    isLowTier = false,
    timeMs = 0
  } = options;

  ctx.save();

  const isThreat = type === "uav" || type === "munition" || type === "bomb" || type === "fpv";
  const baseRadius = isSelected ? 11 : 9.5;

  // 1. Subtle ambient pulse halo for active threats or selected target
  if (!isLowTier && (isThreat || isSelected)) {
    const pulse = 0.5 + 0.5 * Math.sin(timeMs / 420);
    const haloR = baseRadius + 3.5 + (isSelected ? pulse * 3.5 : pulse * 2.0);
    ctx.beginPath();
    ctx.arc(0, 0, haloR, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? `${color}38` : `${color}22`;
    ctx.fill();
    ctx.lineWidth = isSelected ? 1.4 : 0.9;
    ctx.strokeStyle = isSelected ? "#ffffff" : `${color}88`;
    ctx.stroke();
  }

  // 2. Dark obsidian circular backing badge for contrast on both Day and Night satellite imagery
  ctx.beginPath();
  ctx.arc(0, 0, baseRadius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8, 13, 23, 0.90)";
  ctx.fill();
  ctx.lineWidth = isSelected ? 1.8 : 1.3;
  ctx.strokeStyle = isSelected ? "#ffffff" : color;
  ctx.stroke();

  // 3. Crisp vector silhouette inside the badge by target category
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 0.75;
  ctx.lineJoin = "round";

  if (type === "aircraft") {
    // Swept-wing jet aircraft silhouette pointing up (0, -y)
    ctx.beginPath();
    ctx.moveTo(0, -6.5);
    ctx.lineTo(1.3, -3.5);
    ctx.lineTo(6.2, 0.5);
    ctx.lineTo(6.2, 2.0);
    ctx.lineTo(1.3, 0.4);
    ctx.lineTo(1.1, 4.2);
    ctx.lineTo(3.4, 5.6);
    ctx.lineTo(3.4, 6.4);
    ctx.lineTo(0, 5.4);
    ctx.lineTo(-3.4, 6.4);
    ctx.lineTo(-3.4, 5.6);
    ctx.lineTo(-1.1, 4.2);
    ctx.lineTo(-1.3, 0.4);
    ctx.lineTo(-6.2, 2.0);
    ctx.lineTo(-6.2, 0.5);
    ctx.lineTo(-1.3, -3.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (type === "munition") {
    // Sleek cruise missile vector silhouette
    ctx.beginPath();
    ctx.moveTo(0, -6.8);
    ctx.lineTo(1.5, -3.8);
    ctx.lineTo(1.5, -0.8);
    ctx.lineTo(5.6, 1.8);
    ctx.lineTo(5.6, 3.0);
    ctx.lineTo(1.5, 1.5);
    ctx.lineTo(1.4, 4.6);
    ctx.lineTo(3.2, 6.0);
    ctx.lineTo(-3.2, 6.0);
    ctx.lineTo(-1.4, 4.6);
    ctx.lineTo(-1.5, 1.5);
    ctx.lineTo(-5.6, 3.0);
    ctx.lineTo(-5.6, 1.8);
    ctx.lineTo(-1.5, -0.8);
    ctx.lineTo(-1.5, -3.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (type === "bomb") {
    // Guided glide bomb (КАБ / УМПК) vector silhouette
    ctx.beginPath();
    ctx.moveTo(0, -6.2);
    ctx.lineTo(2.0, -3.2);
    ctx.lineTo(2.0, -0.5);
    ctx.lineTo(5.8, 1.0);
    ctx.lineTo(5.8, 2.4);
    ctx.lineTo(1.8, 1.4);
    ctx.lineTo(1.6, 4.8);
    ctx.lineTo(3.2, 6.0);
    ctx.lineTo(-3.2, 6.0);
    ctx.lineTo(-1.6, 4.8);
    ctx.lineTo(-1.8, 1.4);
    ctx.lineTo(-5.8, 2.4);
    ctx.lineTo(-5.8, 1.0);
    ctx.lineTo(-2.0, -0.5);
    ctx.lineTo(-2.0, -3.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (type === "fpv") {
    // 4-rotor tactical X-drone silhouette
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(-4.2, -4.2);
    ctx.lineTo(4.2, 4.2);
    ctx.moveTo(4.2, -4.2);
    ctx.lineTo(-4.2, 4.2);
    ctx.stroke();
    for (const [rx, ry] of [
      [-4.2, -4.2],
      [4.2, -4.2],
      [-4.2, 4.2],
      [4.2, 4.2]
    ]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === "helicopter") {
    // Rotary-wing helicopter silhouette
    ctx.beginPath();
    ctx.ellipse(0, -0.5, 2.2, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(-5.2, -5.2);
    ctx.lineTo(5.2, 5.2);
    ctx.moveTo(5.2, -5.2);
    ctx.lineTo(-5.2, 5.2);
    ctx.stroke();
  } else {
    // Default / UAV: sharp delta-wing strike drone silhouette (Shahed / БпЛА)
    ctx.beginPath();
    ctx.moveTo(0, -6.2);
    ctx.lineTo(5.6, 3.8);
    ctx.lineTo(5.6, 5.0);
    ctx.lineTo(1.6, 3.4);
    ctx.lineTo(0, 4.8);
    ctx.lineTo(-1.6, 3.4);
    ctx.lineTo(-5.6, 5.0);
    ctx.lineTo(-5.6, 3.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}
