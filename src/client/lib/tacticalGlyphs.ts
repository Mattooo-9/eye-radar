// src/client/lib/tacticalGlyphs.ts
/**
 * Modern, minimalist, high-precision vector marker renderer for Eye Radar.
 * Eliminates cartoonish sprites, fake afterburners, and arcade silhouettes in favor of
 * clean cartographic nodes:
 * - Directional vector chevron when heading/course is known.
 * - Concentric sector beacon when only locality/area is reported (speed = 0, no heading).
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
  hasDirection?: boolean;
  isSensor?: boolean;
  isLowTier?: boolean;
  confidence?: number;
  timeMs?: number;
}

export function renderTacticalGlyph(
  ctx: CanvasRenderingContext2D,
  opts: GlyphRenderOptions
): void {
  const { size, color, isSelected, hasDirection = false, isSensor = false, isLowTier = false } = opts;
  const r = Math.max(7, Math.min(12, size * 0.44));

  // 1. Subtle ambient radial halo
  if (!isLowTier) {
    const haloR = isSelected ? r * 2.5 : r * 1.9;
    const grad = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, haloR);
    if (color === "#ef4444" || color === "#dc2626") {
      grad.addColorStop(0, "rgba(239, 68, 68, 0.28)");
      grad.addColorStop(1, "rgba(239, 68, 68, 0)");
    } else if (color === "#f59e0b" || color === "#f97316") {
      grad.addColorStop(0, "rgba(245, 158, 11, 0.26)");
      grad.addColorStop(1, "rgba(245, 158, 11, 0)");
    } else {
      grad.addColorStop(0, "rgba(56, 189, 248, 0.26)");
      grad.addColorStop(1, "rgba(56, 189, 248, 0)");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, haloR, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Selection ring
  if (isSelected) {
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, r + 4.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 3. Dark obsidian disc base with crisp colored perimeter
  ctx.fillStyle = "rgba(8, 13, 23, 0.94)";
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2.0 : 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 4. Inner precision geometry: directional chevron if course is known, concentric dot if area-only
  if (hasDirection || isSensor) {
    // Sleek minimal directional chevron pointing along local -Y (upward before rotation)
    const tipY = -r * 0.56;
    const wingY = r * 0.42;
    const wingX = r * 0.46;
    const notchY = r * 0.16;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, tipY);
    ctx.lineTo(wingX, wingY);
    ctx.lineTo(0, notchY);
    ctx.lineTo(-wingX, wingY);
    ctx.closePath();
    ctx.fill();
  } else {
    // Area-anchored textual report without course: clean luminous core dot
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
}
