// src/client/lib/trackStore.ts
import { SpatialIndex } from "./spatialIndex.js";
import type { TrackPacket, ImpactEvent } from "../hooks/useWsRadar.js";
import { getTierConfig, type PerformanceTier } from "./hardwareBenchmark.js";

export interface RingBufferTrail {
  buffer: Float32Array; // [lat0, lon0, lat1, lon1, ...]
  capacity: number; // max points (e.g. 6, 12, 24)
  count: number;
  head: number; // index of next write
}

export interface ClientUncertaintyEvent {
  id: string;
  lat: number;
  lon: number;
  uncertaintyRadius: number; // in meters
  confidence: number;
  source: string;
  sourceFamily: string;
  label: string;
  timestamp: number;
  details?: string;
}

export class MutableTrackStore {
  private tracks = new Map<string, TrackPacket>();
  private activeList: TrackPacket[] = [];
  private listDirty = true;
  private trails = new Map<string, RingBufferTrail>();
  private spatialIndex = new SpatialIndex<TrackPacket>(16);
  private impacts: ImpactEvent[] = [];
  private listeners = new Set<() => void>();
  private lastNotifyTime = 0;
  private notifyTimer: any = null;
  private tier: PerformanceTier = "NORMAL";

  constructor() {
    // Automatic TTL cleanup every 10 seconds
    if (typeof window !== "undefined") {
      setInterval(() => {
        this.cleanupExpiredTracks();
      }, 10_000);
    }
  }

  setTier(tier: PerformanceTier): void {
    this.tier = tier;
  }

  getTier(): PerformanceTier {
    return this.tier;
  }

  /**
   * Ingests a binary delta update:
   * Coalesces by trackId, updates ring buffers, updates spatial index.
   * Completely bypasses React state!
   */
  ingestDelta(updatedTracks: TrackPacket[], removedIds: string[] = []): void {
    const config = getTierConfig(this.tier);
    const trailCapacity = config.trailPoints;

    // 1. Remove expired / dropped IDs
    for (const id of removedIds) {
      this.tracks.delete(id);
      this.trails.delete(id);
    }

    // 2. Coalesce and update incoming tracks
    for (const packet of updatedTracks) {
      const id = packet[0];
      const lat = packet[2];
      const lon = packet[3];

      this.tracks.set(id, packet);

      // Maintain fixed-size ring buffer for target trails
      let trail = this.trails.get(id);
      if (!trail || trail.capacity !== trailCapacity) {
        trail = {
          buffer: new Float32Array(trailCapacity * 2),
          capacity: trailCapacity,
          count: 0,
          head: 0
        };
        this.trails.set(id, trail);
      }

      const idx = (trail.head * 2) % (trail.capacity * 2);
      trail.buffer[idx] = lat;
      trail.buffer[idx + 1] = lon;
      trail.head = (trail.head + 1) % trail.capacity;
      if (trail.count < trail.capacity) {
        trail.count++;
      }
    }

    this.listDirty = true;
    this.rebuildSpatialIndex();
    this.scheduleNotify();
  }

  /**
   * Complete snapshot replacement
   */
  replaceSnapshot(allTracks: TrackPacket[]): void {
    this.tracks.clear();
    this.trails.clear();
    this.ingestDelta(allTracks, []);
  }

  /**
   * Rebuilds the RBush spatial index for fast viewport queries (<0.2ms)
   */
  private rebuildSpatialIndex(): void {
    const items = [];
    for (const packet of this.tracks.values()) {
      items.push({
        minX: packet[3], // lon
        minY: packet[2], // lat
        maxX: packet[3],
        maxY: packet[2],
        item: packet
      });
    }
    this.spatialIndex.clear();
    this.spatialIndex.load(items);
  }

  /**
   * Viewport culling query: returns only targets within the bounding box
   */
  searchViewport(minLon: number, minLat: number, maxLon: number, maxLat: number): TrackPacket[] {
    return this.spatialIndex.search({
      minX: minLon,
      minY: minLat,
      maxX: maxLon,
      maxY: maxLat
    });
  }

  /**
   * Retrieves chronological points from the fixed-size ring buffer for drawing motion vectors
   */
  getTrailPoints(id: string): Array<[lat: number, lon: number]> {
    const trail = this.trails.get(id);
    if (!trail || trail.count === 0) return [];

    const points: Array<[lat: number, lon: number]> = [];
    const cap = trail.capacity;
    const start = trail.count < cap ? 0 : trail.head;

    for (let i = 0; i < trail.count; i++) {
      const idx = ((start + i) % cap) * 2;
      points.push([trail.buffer[idx], trail.buffer[idx + 1]]);
    }
    return points;
  }

  getTrack(id: string): TrackPacket | undefined {
    return this.tracks.get(id);
  }

  getAllTracks(): TrackPacket[] {
    if (this.listDirty) {
      this.activeList = Array.from(this.tracks.values());
      this.listDirty = false;
    }
    return this.activeList;
  }

  getTrackCount(): number {
    return this.tracks.size;
  }

  setImpacts(events: ImpactEvent[]): void {
    this.impacts = events;
    this.scheduleNotify();
  }

  getImpacts(): ImpactEvent[] {
    return this.impacts;
  }

  setUncertaintyEvents(events: ClientUncertaintyEvent[]): void {
    this.uncertaintyEvents = events;
    this.scheduleNotify();
  }

  getUncertaintyEvents(): ClientUncertaintyEvent[] {
    return this.uncertaintyEvents;
  }

  getUncertaintyCount(): number {
    return this.uncertaintyEvents.length;
  }

  /**
   * Sweeps stale tracks that haven't received updates in >45 seconds
   */
  cleanupExpiredTracks(now = Date.now(), maxAgeMs = 45_000): void {
    let removed = false;
    for (const [id, packet] of this.tracks.entries()) {
      const timestamp = packet[6] || now;
      if (now - timestamp > maxAgeMs) {
        this.tracks.delete(id);
        this.trails.delete(id);
        removed = true;
      }
    }
    if (removed) {
      this.listDirty = true;
      this.rebuildSpatialIndex();
      this.scheduleNotify();
    }
  }

  /**
   * Subscribes UI components to throttled state changes (1Hz)
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private clientMetrics = {
    tracksDecoded: 0,
    tracksStored: 0,
    tracksVisible: 0,
    tracksPerimeter: 0,
    tracksCulled: 0,
    frameCount: 0,
    cullReason: "none"
  };

  recordDecoded(count: number): void {
    this.clientMetrics.tracksDecoded += count;
    this.clientMetrics.tracksStored = this.tracks.size;
  }

  recordRenderFrame(visible: number, perimeter: number, culled: number, cullReason = "none"): void {
    this.clientMetrics.tracksStored = this.tracks.size;
    this.clientMetrics.tracksVisible = visible;
    this.clientMetrics.tracksPerimeter = perimeter;
    this.clientMetrics.tracksCulled = culled;
    this.clientMetrics.cullReason = cullReason;
    this.clientMetrics.frameCount++;
  }

  getClientMetrics() {
    return {
      tracksDecoded: this.clientMetrics.tracksDecoded,
      tracksStored: this.tracks.size,
      tracksVisible: this.clientMetrics.tracksVisible,
      tracksPerimeter: this.clientMetrics.tracksPerimeter,
      tracksCulled: this.clientMetrics.tracksCulled,
      cullReason: this.clientMetrics.cullReason,
      frameCount: this.clientMetrics.frameCount
    };
  }

  private scheduleNotify(): void {
    const now = performance.now();
    // Throttle UI subscriber notifications to once per 800ms to avoid React re-render thrashing
    if (now - this.lastNotifyTime > 800) {
      this.lastNotifyTime = now;
      for (const fn of this.listeners) {
        fn();
      }
    } else if (!this.notifyTimer) {
      this.notifyTimer = setTimeout(() => {
        this.notifyTimer = null;
        this.lastNotifyTime = performance.now();
        for (const fn of this.listeners) {
          fn();
        }
      }, 800);
    }
  }
}

export const trackStore = new MutableTrackStore();
if (typeof window !== "undefined") {
  (window as any).__eyeRadarPipelineDiagnostics = () => trackStore.getClientMetrics();
}
