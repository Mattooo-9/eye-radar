// src/client/lib/hardwareBenchmark.ts

export type PerformanceTier = "LOW" | "NORMAL" | "HIGH";

export interface TierConfig {
  tier: PerformanceTier;
  maxDpr: number;
  targetFps: number;
  frameBudgetMs: number;
  trailPoints: number;
  enableLodClustering: boolean;
  lodThresholdCount: number;
  lazyLoadShaders: boolean;
  minLabelZoom: number;
}

export const TIER_CONFIGS: Record<PerformanceTier, TierConfig> = {
  LOW: {
    tier: "LOW",
    maxDpr: 1.0,
    targetFps: 30,
    frameBudgetMs: 33.3,
    trailPoints: 6,
    enableLodClustering: true,
    lodThresholdCount: 80,
    lazyLoadShaders: true,
    minLabelZoom: 7.5
  },
  NORMAL: {
    tier: "NORMAL",
    maxDpr: 1.5,
    targetFps: 60,
    frameBudgetMs: 16.6,
    trailPoints: 12,
    enableLodClustering: true,
    lodThresholdCount: 250,
    lazyLoadShaders: false,
    minLabelZoom: 6.0
  },
  HIGH: {
    tier: "HIGH",
    maxDpr: 2.0,
    targetFps: 60,
    frameBudgetMs: 16.6,
    trailPoints: 24,
    enableLodClustering: false,
    lodThresholdCount: 600,
    lazyLoadShaders: false,
    minLabelZoom: 5.0
  }
};

let cachedTier: PerformanceTier | null = null;

/**
 * Fast, non-blocking runtime benchmark executed on client startup (<15ms).
 * Tests hardware concurrency, device memory, WebGL renderer capabilities,
 * and canvas 2D fill-rate to automatically select the optimal tier.
 */
export function detectHardwareTier(): PerformanceTier {
  if (cachedTier) return cachedTier;

  try {
    // 1. Check user override from localStorage
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("performanceTier");
      if (saved === "LOW" || saved === "NORMAL" || saved === "HIGH") {
        cachedTier = saved;
        return cachedTier;
      }
    }

    // 2. Hardware concurrency & device memory heuristics
    let score = 50; // Neutral baseline

    if (typeof navigator !== "undefined") {
      const cores = navigator.hardwareConcurrency || 4;
      if (cores <= 2) score -= 35;
      else if (cores <= 4) score -= 15;
      else if (cores >= 8) score += 20;

      const mem = (navigator as any).deviceMemory;
      if (typeof mem === "number") {
        if (mem <= 2) score -= 30;
        else if (mem <= 3) score -= 15;
        else if (mem >= 6) score += 20;
      }

      // Detect mobile user agent (e.g., Telegram WebView on Android)
      const ua = navigator.userAgent.toLowerCase();
      const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
      if (isMobile) {
        score -= 10;
      }
    }

    // 3. WebGL GPU vendor / renderer check
    if (typeof document !== "undefined") {
      try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
        if (gl) {
          const debugInfo = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
          if (debugInfo) {
            const renderer = (gl as WebGLRenderingContext)
              .getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
              .toLowerCase();
            // Lower-end GPUs common in budget budget phones
            if (
              renderer.includes("mali-400") ||
              renderer.includes("mali-g52") ||
              renderer.includes("adreno 505") ||
              renderer.includes("adreno 506") ||
              renderer.includes("adreno 610") ||
              renderer.includes("powervr") ||
              renderer.includes("swiftshader") ||
              renderer.includes("llvmpipe")
            ) {
              score -= 30;
            } else if (
              renderer.includes("apple") ||
              renderer.includes("geforce") ||
              renderer.includes("radeon") ||
              renderer.includes("adreno 660") ||
              renderer.includes("adreno 730") ||
              renderer.includes("adreno 740") ||
              renderer.includes("mali-g78") ||
              renderer.includes("mali-g710")
            ) {
              score += 25;
            }
          }
        }
      } catch {}
    }

    // 4. Quick micro-benchmark: 10,000 float operations
    const t0 = performance.now();
    let acc = 1.0;
    for (let i = 0; i < 15000; i++) {
      acc = (acc * 1.0001 + Math.sin(i)) % 100;
    }
    const elapsed = performance.now() - t0;
    if (elapsed > 6.0) score -= 20;
    else if (elapsed < 1.5) score += 15;

    // Resolve tier based on aggregated score
    if (score < 40) {
      cachedTier = "LOW";
    } else if (score >= 75) {
      cachedTier = "HIGH";
    } else {
      cachedTier = "NORMAL";
    }
  } catch {
    cachedTier = "NORMAL";
  }

  return cachedTier;
}

export function setHardwareTier(tier: PerformanceTier): void {
  cachedTier = tier;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("performanceTier", tier);
    }
  } catch {}
}

export function getTierConfig(tier?: PerformanceTier): TierConfig {
  const active = tier ?? detectHardwareTier();
  return TIER_CONFIGS[active] || TIER_CONFIGS.NORMAL;
}
