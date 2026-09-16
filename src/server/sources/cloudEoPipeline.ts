/**
 * Cloud Earth Observation (EO) Pipeline
 * 
 * Handles STAC/COG metadata, Web Mercator reprojection, overview pyramids,
 * pansharpening (strictly when PAN channel exists), SAR despeckling (Lee filter),
 * and Real-Pixel Computer Vision (registration, change detection, thermal anomaly, object detection).
 * 
 * Strict Principle: AI-enhanced super-resolution is DISPLAY-only. Raw rasters are immutable
 * and synthetic pixels are NEVER used as evidence.
 */

export interface STACCogDescriptor {
  id: string;
  collection: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  epsg: number;
  nativeResolutionMeters: number;
  channels: string[];
  hasPanChannel: boolean;
  panResolutionMeters?: number;
  overviewLevels: number[]; // e.g. [1, 2, 4, 8, 16]
  acquisitionTime: number;
  provider: string;
}

export interface TileCoordinates {
  z: number;
  x: number;
  y: number;
}

export interface CVPixelDetection {
  detectionId: string;
  type: "thermal_hotspot" | "structural_change" | "sar_reflective_anomaly" | "water_variation";
  boundingBox: [minX: number, minY: number, maxX: number, maxY: number];
  approxCoordinates: { lat: number; lon: number };
  pixelCount: number;
  confidence: number;
  provenance: string;
  isDisplayOnlyAI: boolean; // Must be FALSE for real-pixel evidence
}

export interface CVChangeDetectionResult {
  baselineId: string;
  currentId: string;
  changeRatio: number;
  changedPixelCount: number;
  anomalies: CVPixelDetection[];
  provenance: string;
}

/**
 * Reprojects WGS84 (EPSG:4326) coordinates to Web Mercator (EPSG:3857) meters
 */
export function wgs84ToWebMercator(lat: number, lon: number): [x: number, y: number] {
  const x = (lon * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
}

/**
 * Calculates geographic bounding box of a standard Web Mercator tile [z, x, y]
 */
export function tileToBbox(z: number, x: number, y: number): [minLon: number, minLat: number, maxLon: number, maxLat: number] {
  const n = 2 ** z;
  const lonMin = (x / n) * 360 - 180;
  const lonMax = ((x + 1) / n) * 360 - 180;
  const latRadMin = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const latRadMax = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const latMin = (latRadMin * 180) / Math.PI;
  const latMax = (latRadMax * 180) / Math.PI;
  return [lonMin, latMin, lonMax, latMax];
}

/**
 * Applies Brovey pansharpening ONLY when a genuine Panchromatic channel exists.
 * If PAN channel is missing, preserves native resolution without synthetic fabrication.
 */
export function applyPansharpening(
  multispectral: { red: number[][]; green: number[][]; blue: number[][] },
  pan?: number[][]
): { sharpened: boolean; red: number[][]; green: number[][]; blue: number[][]; message: string } {
  if (!pan || pan.length === 0 || pan[0].length === 0) {
    return {
      sharpened: false,
      red: multispectral.red,
      green: multispectral.green,
      blue: multispectral.blue,
      message: "Pansharpening skipped: No genuine PAN channel present. Native multispectral resolution preserved."
    };
  }

  const rows = pan.length;
  const cols = pan[0].length;
  const msRows = multispectral.red.length;
  const msCols = multispectral.red[0].length;

  const outRed: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const outGreen: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const outBlue: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let r = 0; r < rows; r++) {
    const msR = Math.min(msRows - 1, Math.floor((r / rows) * msRows));
    for (let c = 0; c < cols; c++) {
      const msC = Math.min(msCols - 1, Math.floor((c / cols) * msCols));
      const rVal = multispectral.red[msR][msC];
      const gVal = multispectral.green[msR][msC];
      const bVal = multispectral.blue[msR][msC];
      const intensity = (rVal + gVal + bVal) / 3 || 1;
      const panVal = pan[r][c];

      const ratio = panVal / intensity;
      outRed[r][c] = Math.min(255, Math.round(rVal * ratio));
      outGreen[r][c] = Math.min(255, Math.round(gVal * ratio));
      outBlue[r][c] = Math.min(255, Math.round(bVal * ratio));
    }
  }

  return {
    sharpened: true,
    red: outRed,
    green: outGreen,
    blue: outBlue,
    message: "Brovey pansharpening applied using factual high-resolution PAN channel."
  };
}

/**
 * Adaptive Lee filter for SAR radar despeckling.
 * Reduces radar speckle noise while strictly preserving edge gradients and factual backscatter.
 */
export function applyLeeFilter(
  sarMatrix: number[][],
  windowSize = 3
): number[][] {
  const rows = sarMatrix.length;
  if (rows === 0) return [];
  const cols = sarMatrix[0].length;
  const half = Math.floor(windowSize / 2);
  const result: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let sumSq = 0;
      let count = 0;

      for (let wr = -half; wr <= half; wr++) {
        const nr = r + wr;
        if (nr < 0 || nr >= rows) continue;
        for (let wc = -half; wc <= half; wc++) {
          const nc = c + wc;
          if (nc < 0 || nc >= cols) continue;
          const val = sarMatrix[nr][nc];
          sum += val;
          sumSq += val * val;
          count++;
        }
      }

      const mean = sum / count;
      const variance = Math.max(0, sumSq / count - mean * mean);
      const center = sarMatrix[r][c];

      // Lee weighting factor k = var / (var + noiseVar)
      const noiseVariance = 0.28 * mean * mean; // 1-look to 4-look SAR speckle noise estimate
      const k = variance / (variance + noiseVariance + 1e-6);

      result[r][c] = Math.round(mean + k * (center - mean));
    }
  }

  return result;
}

/**
 * Real-Pixel Optical/Thermal Computer Vision Change Detection
 */
export function detectRealPixelChanges(
  baselineRaster: number[][],
  currentRaster: number[][],
  threshold = 30,
  referenceCoord = { lat: 49.0, lon: 32.0 },
  pixelMeters = 10
): CVChangeDetectionResult {
  const rows = Math.min(baselineRaster.length, currentRaster.length);
  const cols = Math.min(baselineRaster[0]?.length ?? 0, currentRaster[0]?.length ?? 0);
  let changedPixels = 0;
  const totalPixels = rows * cols || 1;
  const anomalies: CVPixelDetection[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const diff = Math.abs(currentRaster[r][c] - baselineRaster[r][c]);
      if (diff > threshold) {
        changedPixels++;
        // Identify local clusters
        if (diff > threshold * 2 && anomalies.length < 10) {
          const latOffset = ((rows / 2 - r) * pixelMeters) / 111139;
          const lonOffset = ((c - cols / 2) * pixelMeters) / (111139 * Math.cos((referenceCoord.lat * Math.PI) / 180));
          anomalies.push({
            detectionId: `eo-cv-${r}-${c}`,
            type: "structural_change",
            boundingBox: [c, r, c + 1, r + 1],
            approxCoordinates: {
              lat: Math.round((referenceCoord.lat + latOffset) * 10000) / 10000,
              lon: Math.round((referenceCoord.lon + lonOffset) * 10000) / 10000
            },
            pixelCount: 1,
            confidence: Math.min(0.95, 0.70 + (diff / 255) * 0.25),
            provenance: `Real-Pixel Spectral Differencing (diff=${diff})`,
            isDisplayOnlyAI: false
          });
        }
      }
    }
  }

  return {
    baselineId: "pass-t0",
    currentId: "pass-t1",
    changeRatio: Math.round((changedPixels / totalPixels) * 1000) / 1000,
    changedPixelCount: changedPixels,
    anomalies,
    provenance: "Cloud EO Real-Pixel Change Engine (No Super-Resolution Artifacts)"
  };
}

/**
 * Super-resolution or AI enhancement: STRICTLY display-only.
 * Flagged so downstream fusion will never treat hallucinated pixels as factual evidence.
 */
export function generateDisplayOnlySuperResolution(
  rawMatrix: number[][],
  scaleFactor = 2
): { displayRaster: number[][]; isDisplayOnlyAI: true; warning: string } {
  const rows = rawMatrix.length;
  const cols = rawMatrix[0]?.length ?? 0;
  const outRows = rows * scaleFactor;
  const outCols = cols * scaleFactor;

  const displayRaster: number[][] = Array.from({ length: outRows }, () => new Array(outCols).fill(0));

  for (let r = 0; r < outRows; r++) {
    const srcR = Math.min(rows - 1, Math.floor(r / scaleFactor));
    for (let c = 0; c < outCols; c++) {
      const srcC = Math.min(cols - 1, Math.floor(c / scaleFactor));
      displayRaster[r][c] = rawMatrix[srcR][srcC];
    }
  }

  return {
    displayRaster,
    isDisplayOnlyAI: true,
    warning: "DISPLAY-ONLY ARTIFACT: AI-upscaled details are strictly non-evidentiary."
  };
}
