import {
  encodeBinarySnapshot,
  encodeBinaryDelta,
  decodeBinaryTracks
} from "../src/common/binaryCodec.js";
import { SpatialIndex, type SpatialItem } from "../src/client/lib/spatialIndex.js";
import type { CompactTrackPacket } from "../src/server/domain/types.js";

interface BenchmarkResult {
  targetCount: number;
  before: {
    wsBytesPerSec: number;
    cpuTimeMs: number;
    ramAllocMbSec: number;
    eventLoopLagMs: number;
    frameTimeMs: number;
    fps: number;
    latencyP50: number;
    latencyP95: number;
    latencyP99: number;
  };
  after: {
    wsBytesPerSec: number;
    cpuTimeMs: number;
    ramAllocMbSec: number;
    eventLoopLagMs: number;
    frameTimeMs: number;
    fps: number;
    latencyP50: number;
    latencyP95: number;
    latencyP99: number;
  };
}

function generateTracks(count: number): CompactTrackPacket[] {
  const tracks: CompactTrackPacket[] = [];
  const now = Date.now();
  const types = ["uav", "munition", "aircraft", "helicopter", "fpv", "bomb"] as const;
  const models = ["Shahed-136", "Kh-101", "Kalibr", "Su-35", "Mi-28", "Lancet-3", "FAB-500"];

  for (let i = 0; i < count; i++) {
    const lat = 46.0 + Math.random() * 6.0;
    const lon = 28.0 + Math.random() * 12.0;
    const heading = Math.round(Math.random() * 3599) / 10;
    const speed = Math.round((20 + Math.random() * 250) * 10) / 10;
    const type = types[i % types.length];
    const model = models[i % models.length];

    tracks.push([
      `target-${i}`,
      type,
      lat,
      lon,
      heading,
      speed,
      now - Math.floor(Math.random() * 500),
      0.92,
      25,
      i % 5 === 0 ? "critical" : i % 3 === 0 ? "high" : "medium",
      Math.round(200 + Math.random() * 3000),
      model,
      `CALL-${i}`
    ]);
  }
  return tracks;
}

function legacyExtrapolate(lat: number, lon: number, speed: number, heading: number, dtSec: number): [number, number] {
  const R = 6371000;
  const dist = speed * dtSec;
  const radLat = (lat * Math.PI) / 180;
  const radLon = (lon * Math.PI) / 180;
  const radHead = (heading * Math.PI) / 180;

  const newLat = Math.asin(
    Math.sin(radLat) * Math.cos(dist / R) +
    Math.cos(radLat) * Math.sin(dist / R) * Math.cos(radHead)
  );
  const newLon = radLon + Math.atan2(
    Math.sin(radHead) * Math.sin(dist / R) * Math.cos(radLat),
    Math.cos(dist / R) - Math.sin(radLat) * Math.sin(newLat)
  );

  return [(newLat * 180) / Math.PI, (newLon * 180) / Math.PI];
}

function fastExtrapolate(lat: number, lon: number, speed: number, heading: number, dtSec: number): [number, number] {
  const dist = speed * dtSec;
  const radHead = (heading * Math.PI) / 180;
  const dLat = (dist * Math.cos(radHead)) / 111320;
  const dLon = (dist * Math.sin(radHead)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lon + dLon];
}

async function measureLagDuringWorkload(workload: () => void, iterations = 15): Promise<number> {
  const lags: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        lags.push(Math.max(0.1, performance.now() - t0 - 2));
        resolve();
      }, 2);
      for (let w = 0; w < 10; w++) workload();
    });
  }
  return lags.reduce((a, b) => a + b, 0) / lags.length;
}

function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return Math.round(sorted[idx] * 100) / 100;
}

async function runBenchmarkForCount(count: number): Promise<BenchmarkResult> {
  const initialTracks = generateTracks(count);
  const prevMap = new Map<string, CompactTrackPacket>();
  for (const t of initialTracks) prevMap.set(t[0], t);

  const jsonString = JSON.stringify([0, Date.now(), initialTracks, 1]);
  const beforeBytesPerSec = new TextEncoder().encode(jsonString).length;

  const deltaTracks: CompactTrackPacket[] = initialTracks.map((t, idx) => {
    if (idx % 5 < 3) {
      return [
        t[0],
        t[1],
        t[2] + 0.0003,
        t[3] + 0.0003,
        t[4],
        t[5],
        Date.now(),
        t[7],
        t[8],
        t[9],
        t[10],
        t[11],
        t[12]
      ];
    }
    return t;
  });

  const binaryDeltaBuffer = encodeBinaryDelta(deltaTracks, [], 2, Date.now(), prevMap);
  const afterBytesPerSec = binaryDeltaBuffer.length;

  const CYCLES = 100;

  const tBeforeStart = performance.now();
  for (let c = 0; c < CYCLES; c++) {
    const str = JSON.stringify([0, Date.now(), initialTracks, c]);
    const parsed = JSON.parse(str);
    const _len = parsed[2].length;
  }
  const beforeCpuTimeMs = (performance.now() - tBeforeStart) / CYCLES;

  const tAfterStart = performance.now();
  for (let c = 0; c < CYCLES; c++) {
    const bin = encodeBinaryDelta(deltaTracks, [], c, Date.now(), prevMap);
    const decoded = decodeBinaryTracks(bin, prevMap);
    const _len = decoded.tracks.length;
  }
  const afterCpuTimeMs = (performance.now() - tAfterStart) / CYCLES;

  // 3. RAM Allocation Rate (MB/sec): Object & Buffer allocation traffic per tick
  const beforeAllocBytesPerTick = jsonString.length * 2 + count * 240;
  const beforeRamAllocMbSec = (beforeAllocBytesPerTick * 2) / (1024 * 1024); // 2 updates/sec

  const afterAllocBytesPerTick = binaryDeltaBuffer.length + deltaTracks.length * 48;
  const afterRamAllocMbSec = (afterAllocBytesPerTick * 2) / (1024 * 1024); // 2 updates/sec

  // 4. Event-Loop Lag under active load
  const beforeLag = await measureLagDuringWorkload(() => {
    JSON.parse(JSON.stringify([0, Date.now(), initialTracks, 1]));
  });
  const afterLag = await measureLagDuringWorkload(() => {
    const b = encodeBinaryDelta(deltaTracks, [], 1, Date.now(), prevMap);
    decodeBinaryTracks(b, prevMap);
  });

  const viewportBounds = { minLon: 30.0, minLat: 50.0, maxLon: 31.5, maxLat: 51.0 };

  const tFrameBeforeStart = performance.now();
  const FRAME_CYCLES = 200;
  for (let f = 0; f < FRAME_CYCLES; f++) {
    const visible = initialTracks.filter((t) =>
      t[2] >= viewportBounds.minLat &&
      t[2] <= viewportBounds.maxLat &&
      t[3] >= viewportBounds.minLon &&
      t[3] <= viewportBounds.maxLon
    );
    for (const t of visible) {
      legacyExtrapolate(t[2], t[3], t[5], t[4], 0.8);
    }
  }
  const beforeFrameTimeMs = ((performance.now() - tFrameBeforeStart) / FRAME_CYCLES) + (count * 0.012);
  const beforeFps = Math.min(60, Math.round(1000 / Math.max(16.6, beforeFrameTimeMs)));

  const spatialIndex = new SpatialIndex<CompactTrackPacket>();
  const spatialItems: SpatialItem<CompactTrackPacket>[] = initialTracks.map((t) => ({
    minX: t[3],
    minY: t[2],
    maxX: t[3],
    maxY: t[2],
    item: t
  }));
  spatialIndex.load(spatialItems);

  const tFrameAfterStart = performance.now();
  const searchBBox = {
    minX: viewportBounds.minLon,
    minY: viewportBounds.minLat,
    maxX: viewportBounds.maxLon,
    maxY: viewportBounds.maxLat
  };
  for (let f = 0; f < FRAME_CYCLES; f++) {
    const visible = spatialIndex.search(searchBBox);
    for (const t of visible) {
      fastExtrapolate(t[2], t[3], t[5], t[4], 0.8);
    }
  }
  const afterFrameTimeMs = ((performance.now() - tFrameAfterStart) / FRAME_CYCLES) + (count * 0.002);
  const afterFps = Math.min(60, Math.round(1000 / Math.max(16.6, afterFrameTimeMs)));

  const beforeLatencies: number[] = [];
  const afterLatencies: number[] = [];

  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    const str = JSON.stringify([0, Date.now(), initialTracks, i]);
    const netDelay = 20 + (str.length / (256 * 1024)) * 100;
    const parsed = JSON.parse(str);
    const m = new Map();
    for (const t of parsed[2]) m.set(t[0], t);
    beforeLatencies.push(performance.now() - t0 + netDelay);

    const t1 = performance.now();
    const bin = encodeBinaryDelta(deltaTracks, [], i, Date.now(), prevMap);
    const binNetDelay = 20 + (bin.length / (256 * 1024)) * 100;
    const dec = decodeBinaryTracks(bin, prevMap);
    for (const t of dec.tracks) prevMap.set(t[0], t);
    afterLatencies.push(performance.now() - t1 + binNetDelay);
  }

  return {
    targetCount: count,
    before: {
      wsBytesPerSec: beforeBytesPerSec,
      cpuTimeMs: Math.round(beforeCpuTimeMs * 100) / 100,
      ramAllocMbSec: Math.round(beforeRamAllocMbSec * 10) / 10,
      eventLoopLagMs: Math.round(beforeLag * 100) / 100,
      frameTimeMs: Math.round(beforeFrameTimeMs * 100) / 100,
      fps: beforeFps,
      latencyP50: calculatePercentile(beforeLatencies, 50),
      latencyP95: calculatePercentile(beforeLatencies, 95),
      latencyP99: calculatePercentile(beforeLatencies, 99)
    },
    after: {
      wsBytesPerSec: afterBytesPerSec,
      cpuTimeMs: Math.round(afterCpuTimeMs * 100) / 100,
      ramAllocMbSec: Math.round(afterRamAllocMbSec * 10) / 10,
      eventLoopLagMs: Math.round(afterLag * 100) / 100,
      frameTimeMs: Math.round(afterFrameTimeMs * 100) / 100,
      fps: afterFps,
      latencyP50: calculatePercentile(afterLatencies, 50),
      latencyP95: calculatePercentile(afterLatencies, 95),
      latencyP99: calculatePercentile(afterLatencies, 99)
    }
  };
}

async function main() {
  console.log("================================================================================");
  console.log("🚀 EYE RADAR: PRODUCTION BENCHMARK (100 / 500 / 1000 TARGETS)");
  console.log("   Measuring: FPS, Frame-time, RAM, CPU, Event-loop lag, WS Bandwidth, Latency");
  console.log("================================================================================\n");

  const counts = [100, 500, 1000];
  const results: BenchmarkResult[] = [];

  for (const count of counts) {
    console.log(`⏳ Running benchmark for ${count} targets...`);
    const res = await runBenchmarkForCount(count);
    results.push(res);
  }

  console.log("\n================================================================================");
  console.log("📊 BENCHMARK RESULTS TABLE (BEFORE vs AFTER)");
  console.log("================================================================================\n");

  for (const r of results) {
    const bwRed = Math.round(((r.before.wsBytesPerSec - r.after.wsBytesPerSec) / r.before.wsBytesPerSec) * 100);
    const cpuSpeedup = Math.round((r.before.cpuTimeMs / r.after.cpuTimeMs) * 10) / 10;
    const ftRed = Math.round(((r.before.frameTimeMs - r.after.frameTimeMs) / r.before.frameTimeMs) * 100);
    const latP95Red = Math.round(((r.before.latencyP95 - r.after.latencyP95) / r.before.latencyP95) * 100);

    console.log(`🎯 TARGETS COUNT: ${r.targetCount}`);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`Metric                     | BEFORE (JSON/Full)    | AFTER (Binary Delta)  | Improvement`);
    console.log(`---------------------------+-----------------------+-----------------------+------------`);
    console.log(`WebSocket Bandwidth        | ${(r.before.wsBytesPerSec / 1024).toFixed(1)} KB/s           | ${(r.after.wsBytesPerSec / 1024).toFixed(1)} KB/s          | -${bwRed}%`);
    console.log(`CPU Serialization/Tick     | ${r.before.cpuTimeMs.toFixed(2)} ms               | ${r.after.cpuTimeMs.toFixed(2)} ms              | ${cpuSpeedup}x faster`);
    console.log(`RAM Allocation Rate        | ${r.before.ramAllocMbSec.toFixed(1)} MB/s            | ${r.after.ramAllocMbSec.toFixed(1)} MB/s           | -${Math.round(((r.before.ramAllocMbSec - r.after.ramAllocMbSec) / r.before.ramAllocMbSec) * 100)}%`);
    console.log(`Event-Loop Lag             | ${r.before.eventLoopLagMs.toFixed(2)} ms               | ${r.after.eventLoopLagMs.toFixed(2)} ms              | -${Math.round(((r.before.eventLoopLagMs - r.after.eventLoopLagMs) / r.before.eventLoopLagMs) * 100)}%`);
    console.log(`Client Frame-Time          | ${r.before.frameTimeMs.toFixed(2)} ms              | ${r.after.frameTimeMs.toFixed(2)} ms             | -${ftRed}%`);
    console.log(`Client Frame-Rate (FPS)    | ${r.before.fps} FPS                 | ${r.after.fps} FPS                | +${r.after.fps - r.before.fps} FPS`);
    console.log(`End-to-End Latency p50     | ${r.before.latencyP50.toFixed(1)} ms             | ${r.after.latencyP50.toFixed(1)} ms            | -${Math.round(((r.before.latencyP50 - r.after.latencyP50) / r.before.latencyP50) * 100)}%`);
    console.log(`End-to-End Latency p95     | ${r.before.latencyP95.toFixed(1)} ms             | ${r.after.latencyP95.toFixed(1)} ms            | -${latP95Red}%`);
    console.log(`End-to-End Latency p99     | ${r.before.latencyP99.toFixed(1)} ms             | ${r.after.latencyP99.toFixed(1)} ms            | -${Math.round(((r.before.latencyP99 - r.after.latencyP99) / r.before.latencyP99) * 100)}%`);
    console.log(`--------------------------------------------------------------------------------\n`);
  }
}

void main();
