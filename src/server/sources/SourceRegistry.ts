import type { Source } from "./sourceInterface.js";

export interface SourceCapability {
  canCreateTrack: boolean;
  canClassify: boolean;
  canProvidePosition: boolean;
  canProvideAltitude: boolean;
  canProvideSpeed: boolean;
  evidenceTypes: string[]; // e.g. ["alert", "adsb", "weather"]
  coverage?: { region: string; quality: number };
}

export interface RegisteredSource {
  name: string;
  family: string; // alerts, adsb, weather, test
  instance: Source; // implements fetchTracks()/start()
  capability: SourceCapability;
  isReserve?: boolean; // becomes LIVE only after successful request
  disabled?: boolean; // legacy adapters kept for future use
}

export class SourceRegistry {
  private sources: Map<string, RegisteredSource> = new Map();
  private healthTracker?: any;

  setHealthTracker(tracker: any) {
    this.healthTracker = tracker;
  }

  get(name: string): RegisteredSource | undefined {
    return this.sources.get(name);
  }

  register(
    name: string,
    family: string,
    instance: Source,
    capability: SourceCapability,
    opts?: { isReserve?: boolean; disabled?: boolean }
  ) {
    const reg: RegisteredSource = {
      name,
      family,
      instance,
      capability,
      isReserve: opts?.isReserve,
      disabled: opts?.disabled,
    };
    this.sources.set(name, reg);
    // Register with health tracker (even if disabled/reserve)
    if (this.healthTracker?.registerSource) {
      this.healthTracker.registerSource(name);
    }
    // If source has a start method, invoke it (e.g., begin fetching)
    if (typeof (instance as any).start === "function") {
      (instance as any).start();
    }
  }

  getActiveSources(): RegisteredSource[] {
    const active: RegisteredSource[] = [];
    for (const src of this.sources.values()) {
      if (src.disabled) continue;
      const health = this.healthTracker?.sources?.get?.(src.name);
      const state = health?.state ?? "LIVE";
      if (state === "LIVE" || src.family === "test" || !this.healthTracker) {
        active.push(src);
      }
    }
    return active;
  }

  hasLivePositionalSource(): boolean {
    // Returns true if there is at least one LIVE source that can create tracks and provides position
    const active = this.getActiveSources();
    return active.some(src => src.capability.canCreateTrack && src.capability.canProvidePosition);
  }
}

export const sourceRegistry = new SourceRegistry();
