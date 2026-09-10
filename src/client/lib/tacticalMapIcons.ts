// High-Precision Military Tactical Icon Atlas for MapLibre WebGL Engine
// All silhouettes are drawn centered at (size/2, size/2) with nose oriented strictly UP (0° / North)
// When rendered with 'icon-rotate': ['get', 'heading'] and 'icon-rotation-alignment': 'map',
// the target's nose is 100% locked to flight trajectory with ZERO drift on any zoom level.

import type { Map as MapLibreMap } from "maplibre-gl";

const createIconImageData = (
  drawFn: (ctx: CanvasRenderingContext2D, size: number) => void,
  size = 72
): ImageData => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx) {
    drawFn(ctx, size);
    return ctx.getImageData(0, 0, size, size);
  }
  return new ImageData(size, size);
};

// 1. Shahed-136 Kamikaze Delta Wing (Dark graphite stealth RAM, red threat outline, nose radome, pusher prop)
const drawShahed136 = (ctx: CanvasRenderingContext2D, size: number) => {
  const cx = size / 2;
  const cy = size / 2;
  const s = size * 0.44;

  ctx.save();
  ctx.translate(cx, cy);

  // Tactical drop shadow
  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;

  // Delta wing base shape (nose at -y, tail at +y)
  ctx.fillStyle = "#18181b"; // Stealth dark RAM coating
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.96); // Nose tip
  ctx.lineTo(s * 0.82, s * 0.50); // Starboard wingtip
  ctx.lineTo(s * 0.82, s * 0.70); // Winglet trailing edge
  ctx.lineTo(s * 0.68, s * 0.70); // Winglet inner edge
  ctx.lineTo(s * 0.18, s * 0.48); // Starboard motor mount
  ctx.lineTo(s * 0.12, s * 0.62); // Motor bay starboard
  ctx.lineTo(-s * 0.12, s * 0.62); // Motor bay port
  ctx.lineTo(-s * 0.18, s * 0.48); // Port motor mount
  ctx.lineTo(-s * 0.68, s * 0.70); // Winglet inner edge port
  ctx.lineTo(-s * 0.82, s * 0.70); // Winglet trailing edge port
  ctx.lineTo(-s * 0.82, s * 0.50); // Port wingtip
  ctx.closePath();
  ctx.fill();

  // High-visibility threat border
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Central fuselage fairing
  ctx.fillStyle = "#27272a";
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.1, s * 0.15, s * 0.52, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(239, 68, 68, 0.7)";
  ctx.lineWidth = 1.0;
  ctx.stroke();

  // Wing structural panel lines
  ctx.strokeStyle = "rgba(161, 161, 170, 0.4)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.5);
  ctx.lineTo(s * 0.65, s * 0.44);
  ctx.moveTo(0, -s * 0.5);
  ctx.lineTo(-s * 0.65, s * 0.44);
  ctx.stroke();

  // Wingtip vertical stabilizer fins (with high-visibility chevrons)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-s * 0.82, s * 0.44, 2.5, s * 0.24);
  ctx.fillRect(s * 0.82 - 2.5, s * 0.44, 2.5, s * 0.24);
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(-s * 0.82, s * 0.44, 2.5, s * 0.08);
  ctx.fillRect(s * 0.82 - 2.5, s * 0.44, 2.5, s * 0.08);

  // Nose guidance radome (glowing white tip pointing FORWARD)
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -s * 0.88, 2.8, 0, Math.PI * 2);
  ctx.fill();

  // Rear pusher propeller hub & spinning disc
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.arc(0, s * 0.62, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(254, 202, 202, 0.75)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-s * 0.22, s * 0.62);
  ctx.lineTo(s * 0.22, s * 0.62);
  ctx.stroke();

  ctx.restore();
};

// 2. Shahed-238 Turbojet Powered Delta Wing (Black RAM, glowing amber border, dorsal intake, jet flame)
const drawShahed238 = (ctx: CanvasRenderingContext2D, size: number) => {
  const cx = size / 2;
  const cy = size / 2;
  const s = size * 0.44;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.shadowColor = "rgba(0, 0, 0, 0.95)";
  ctx.shadowBlur = 6;

  // Stealth Black Airframe
  ctx.fillStyle = "#09090b";
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.96);
  ctx.lineTo(s * 0.78, s * 0.52);
  ctx.lineTo(s * 0.78, s * 0.70);
  ctx.lineTo(s * 0.65, s * 0.70);
  ctx.lineTo(s * 0.20, s * 0.48);
  ctx.lineTo(s * 0.14, s * 0.68); // Jet exhaust starboard
  ctx.lineTo(-s * 0.14, s * 0.68); // Jet exhaust port
  ctx.lineTo(-s * 0.20, s * 0.48);
  ctx.lineTo(-s * 0.65, s * 0.70);
  ctx.lineTo(-s * 0.78, s * 0.70);
  ctx.lineTo(-s * 0.78, s * 0.52);
  ctx.closePath();
  ctx.fill();

  // Glowing Thermal Border
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Dorsal air intake scoop
  ctx.fillStyle = "#ea580c";
  ctx.fillRect(-s * 0.08, -s * 0.14, s * 0.16, s * 0.25);

  // Turbojet exhaust plume
  const grad = ctx.createLinearGradient(0, s * 0.68, 0, s * 1.05);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.3, "#f97316");
  grad.addColorStop(1, "rgba(239, 68, 68, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-s * 0.12, s * 0.68);
  ctx.lineTo(0, s * 1.05);
  ctx.lineTo(s * 0.12, s * 0.68);
  ctx.closePath();
  ctx.fill();

  // Nose guidance point
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -s * 0.88, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// 3. High-Aspect Reconnaissance UAV (Supercam S350 / Orlan-10)
const drawReconUav = (ctx: CanvasRenderingContext2D, size: number) => {
  const cx = size / 2;
  const cy = size / 2;
  const s = size * 0.44;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 5;

  ctx.fillStyle = "#1e293b";
  // Long fuselage
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.14, s * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // High-aspect straight glider wings
  ctx.beginPath();
  ctx.rect(-s * 0.95, -s * 0.10, s * 1.9, s * 0.20);
  ctx.fill();
  ctx.stroke();

  // V-tail
  ctx.beginPath();
  ctx.moveTo(-s * 0.35, s * 0.65);
  ctx.lineTo(0, s * 0.50);
  ctx.lineTo(s * 0.35, s * 0.65);
  ctx.stroke();

  // Optical gimbal camera turret at nose
  ctx.fillStyle = "#38bdf8";
  ctx.beginPath();
  ctx.arc(0, -s * 0.68, 2.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// 4. Guided Glide Bomb (КАБ-500 / КАБ-1500 with deployed pop-out UMPK swept wings)
const drawKab500 = (ctx: CanvasRenderingContext2D, size: number) => {
  const cx = size / 2;
  const cy = size / 2;
  const s = size * 0.44;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 6;

  // Deployed UMPK pop-out wings
  ctx.fillStyle = "#334155";
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.15);
  ctx.lineTo(-s * 1.15, s * 0.16);
  ctx.lineTo(-s * 1.15, s * 0.30);
  ctx.lineTo(-s * 0.18, s * 0.14);
  ctx.lineTo(s * 0.18, s * 0.14);
  ctx.lineTo(s * 1.15, s * 0.30);
  ctx.lineTo(s * 1.15, s * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Wing warning red tips
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(-s * 1.15, s * 0.16, s * 0.22, s * 0.12);
  ctx.fillRect(s * 0.93, s * 0.16, s * 0.22, s * 0.12);

  // Heavy FAB bomb casing
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.98); // Bomb nose
  ctx.lineTo(s * 0.20, -s * 0.65);
  ctx.lineTo(s * 0.24, 0);
  ctx.lineTo(s * 0.24, s * 0.45);
  ctx.lineTo(s * 0.14, s * 0.74);
  ctx.lineTo(-s * 0.14, s * 0.74);
  ctx.lineTo(-s * 0.24, s * 0.45);
  ctx.lineTo(-s * 0.24, 0);
  ctx.lineTo(-s * 0.20, -s * 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cruciform tail fins
  ctx.beginPath();
  ctx.moveTo(-s * 0.14, s * 0.65);
  ctx.lineTo(-s * 0.48, s * 0.85);
  ctx.lineTo(-s * 0.48, s * 0.92);
  ctx.lineTo(-s * 0.10, s * 0.78);
  ctx.moveTo(s * 0.14, s * 0.65);
  ctx.lineTo(s * 0.48, s * 0.85);
  ctx.lineTo(s * 0.48, s * 0.92);
  ctx.lineTo(s * 0.10, s * 0.78);
  ctx.stroke();

  // Hardened nose fuze pin
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -s * 0.95, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// 5. Strike FPV Drone (X-Frame quadcopter with spinning rotors and forward camera)
const drawFpvQuad = (ctx: CanvasRenderingContext2D, size: number) => {
  const cx = size / 2;
  const cy = size / 2;
  const s = size * 0.44;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 5;

  // Carbon X-Frame diagonal arms
  const arm = s * 0.72;
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-arm, -arm);
  ctx.lineTo(arm, arm);
  ctx.moveTo(arm, -arm);
  ctx.lineTo(-arm, arm);
  ctx.stroke();

  // 4 Rotor discs
  const propR = s * 0.32;
  const motors = [[-arm, -arm], [arm, -arm], [-arm, arm], [arm, arm]];
  for (const [mx, my] of motors) {
    ctx.beginPath();
    ctx.arc(mx, my, propR, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(217, 70, 239, 0.25)";
    ctx.fill();
    ctx.strokeStyle = "rgba(217, 70, 239, 0.75)";
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // Central motor hub
    ctx.fillStyle = "#64748b";
    ctx.beginPath();
    ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Under-slung munition
  ctx.fillStyle = "#334155";
  ctx.beginPath();
  ctx.ellipse(0, s * 0.05, s * 0.16, s * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f43f5e";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Central battery & stack
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(-s * 0.22, -s * 0.28, s * 0.44, s * 0.56);
  ctx.strokeStyle = "#d946ef";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(-s * 0.22, -s * 0.28, s * 0.44, s * 0.56);

  // Front FPV camera lens (strictly forward / top!)
  ctx.fillStyle = "#0284c7";
  ctx.beginPath();
  ctx.arc(0, -s * 0.36, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#38bdf8";
  ctx.beginPath();
  ctx.arc(0, -s * 0.36, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// 6. Cruise Missile (Kh-101 / Kalibr with ogive radome, deployed wings, tail fins)
const drawCruiseMissile = (ctx: CanvasRenderingContext2D, size: number) => {
  const cx = size / 2;
  const cy = size / 2;
  const s = size * 0.44;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = 6;

  ctx.fillStyle = "#f97316";
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.0); // Nose tip
  ctx.lineTo(s * 0.16, -s * 0.65);
  ctx.lineTo(s * 0.16, -s * 0.15);
  ctx.lineTo(s * 0.72, -s * 0.05); // Deployed cruise wing
  ctx.lineTo(s * 0.72, s * 0.06);
  ctx.lineTo(s * 0.16, 0);
  ctx.lineTo(s * 0.16, s * 0.62);
  ctx.lineTo(s * 0.40, s * 0.76); // Tail fin
  ctx.lineTo(s * 0.40, s * 0.84);
  ctx.lineTo(s * 0.14, s * 0.76);
  ctx.lineTo(0, s * 0.74);
  ctx.lineTo(-s * 0.14, s * 0.76);
  ctx.lineTo(-s * 0.40, s * 0.84);
  ctx.lineTo(-s * 0.40, s * 0.76);
  ctx.lineTo(-s * 0.16, s * 0.62);
  ctx.lineTo(-s * 0.16, 0);
  ctx.lineTo(-s * 0.72, s * 0.06);
  ctx.lineTo(-s * 0.72, -s * 0.05);
  ctx.lineTo(-s * 0.16, -s * 0.15);
  ctx.lineTo(-s * 0.16, -s * 0.65);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Nose radome tip
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -s * 0.95, 2.0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// 7. Tactical Fighter / Jet Aircraft (Su-34 / F-16 / Civil aviation)
const drawTacticalJet = (ctx: CanvasRenderingContext2D, size: number) => {
  const cx = size / 2;
  const cy = size / 2;
  const s = size * 0.44;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 5;

  ctx.fillStyle = "#0284c7";
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.98); // Nose cone
  ctx.lineTo(s * 0.15, -s * 0.55);
  ctx.lineTo(s * 0.15, -s * 0.15);
  ctx.lineTo(s * 0.85, s * 0.28); // Swept wing
  ctx.lineTo(s * 0.85, s * 0.38);
  ctx.lineTo(s * 0.18, s * 0.22);
  ctx.lineTo(s * 0.18, s * 0.68);
  ctx.lineTo(s * 0.42, s * 0.85); // Tailplane
  ctx.lineTo(s * 0.42, s * 0.92);
  ctx.lineTo(0, s * 0.80);
  ctx.lineTo(-s * 0.42, s * 0.92);
  ctx.lineTo(-s * 0.42, s * 0.85);
  ctx.lineTo(-s * 0.18, s * 0.68);
  ctx.lineTo(-s * 0.18, s * 0.22);
  ctx.lineTo(-s * 0.85, s * 0.38);
  ctx.lineTo(-s * 0.85, s * 0.28);
  ctx.lineTo(-s * 0.15, -s * 0.15);
  ctx.lineTo(-s * 0.15, -s * 0.55);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Glass canopy
  ctx.fillStyle = "#bae6fd";
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.62, s * 0.08, s * 0.20, 0, 0, Math.PI * 2);
  ctx.fill();

  // Navigation lights: Left Port (Red), Right Starboard (Green)
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(-s * 0.85, s * 0.33, 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#22c55e";
  ctx.beginPath();
  ctx.arc(s * 0.85, s * 0.33, 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// 8. Helicopter (Ka-52 / Mi-8 fuselage with 4-blade rotor blur)
const drawHelicopter = (ctx: CanvasRenderingContext2D, size: number) => {
  const cx = size / 2;
  const cy = size / 2;
  const s = size * 0.44;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 5;

  // Cabin
  ctx.fillStyle = "#10b981";
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.15, s * 0.28, s * 0.54, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Glass canopy
  ctx.fillStyle = "#bae6fd";
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.42, s * 0.16, s * 0.20, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail boom
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.35);
  ctx.lineTo(0, s * 0.98);
  ctx.lineTo(s * 0.25, s * 0.98);
  ctx.stroke();

  // Main rotor blur disc
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.95);
  ctx.lineTo(0, s * 0.65);
  ctx.moveTo(-s * 0.80, -s * 0.15);
  ctx.lineTo(s * 0.80, -s * 0.15);
  ctx.stroke();

  // Central mast
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -s * 0.15, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// 9. Impact Marker (💥 ПРИЛІТ)
const drawImpactMarker = (ctx: CanvasRenderingContext2D, size: number) => {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = 6;

  // Tactical red disc
  ctx.fillStyle = "rgba(220, 38, 38, 0.95)";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fecaca";
  ctx.lineWidth = 2.0;
  ctx.stroke();

  // Inner core
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

// 10. Intercept Marker (🛡️ ЗБИТТЯ ППО)
const drawInterceptMarker = (ctx: CanvasRenderingContext2D, size: number) => {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  ctx.save();
  ctx.translate(cx, cy);

  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = 6;

  // Tactical cyan disc
  ctx.fillStyle = "rgba(14, 116, 144, 0.95)";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#bae6fd";
  ctx.lineWidth = 2.0;
  ctx.stroke();

  // Inner core
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
};

export const registerTacticalMapIcons = (map: MapLibreMap): void => {
  const icons: Array<{ id: string; draw: (ctx: CanvasRenderingContext2D, size: number) => void; size?: number }> = [
    { id: "icon-shahed-136", draw: drawShahed136 },
    { id: "icon-shahed-238", draw: drawShahed238 },
    { id: "icon-uav-recon", draw: drawReconUav },
    { id: "icon-kab-500", draw: drawKab500 },
    { id: "icon-fpv-quad", draw: drawFpvQuad },
    { id: "icon-munition", draw: drawCruiseMissile },
    { id: "icon-aircraft", draw: drawTacticalJet },
    { id: "icon-helicopter", draw: drawHelicopter },
    { id: "icon-impact-marker", draw: drawImpactMarker, size: 48 },
    { id: "icon-intercept-marker", draw: drawInterceptMarker, size: 48 }
  ];

  for (const { id, draw, size = 72 } of icons) {
    if (!map.hasImage(id)) {
      try {
        const imgData = createIconImageData(draw, size);
        map.addImage(id, imgData, { pixelRatio: 2 });
      } catch {}
    }
  }
};
