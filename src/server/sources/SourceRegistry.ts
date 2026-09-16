import type { Source } from "./sourceInterface.js";

export type CapabilityType =
  | "TRACK_POSITION"
  | "THREAT_ALERT"
  | "WEATHER"
  | "EARTH_OBSERVATION"
  | "TEST_SIMULATION";

export type EvidenceFamily =
  | "adsb_mlat"
  | "threat_alert"
  | "weather"
  | "earth_observation"
  | "test_simulation"
  | "sdr_local"
  | "osint";

export interface SourceCapability {
  primaryCapability: CapabilityType;
  capabilities: CapabilityType[];
  canCreateTrack: boolean;
  canClassify: boolean;
  canProvidePosition: boolean;
  canProvideAltitude: boolean;
  canProvideSpeed: boolean;
  evidenceFamily: EvidenceFamily;
  evidenceTypes: string[]; // e.g. ["alert", "adsb", "weather"]
  coverage?: { region: string; quality: number };
}

export interface RegisteredSource {
  name: string;
  family: string;
  instance: Source;
  capability: SourceCapability;
  isReserve?: boolean;
  disabled?: boolean;
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

  getAll(): RegisteredSource[] {
    return Array.from(this.sources.values());
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
    if (this.healthTracker?.registerSource) {
      this.healthTracker.registerSource(name);
    }
    if (typeof (instance as any).start === "function") {
      (instance as any).start();
    }
  }

  getSourceState(name: string): "LIVE" | "DEGRADED" | "STALE" | "OFFLINE" {
    const src = this.sources.get(name);
    if (!src || src.disabled) return "OFFLINE";
    if (this.healthTracker) {
      return this.healthTracker.getSourceState?.(name) ?? "OFFLINE";
    }
    return "OFFLINE";
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

  /**
   * Real LIVE positional sources: strictly provides coordinate observations (ADS-B / MLAT).
   * E.g. adsb.lol, airplanes.live. Alerts and simulation are NEVER included.
   */
  getLivePositionalSources(): RegisteredSource[] {
    return Array.from(this.sources.values()).filter(src => {
      if (src.disabled) return false;
      if (src.capability.primaryCapability !== "TRACK_POSITION") return false;
      if (src.capability.capabilities.includes("TEST_SIMULATION")) return false;
      return this.getSourceState(src.name) === "LIVE";
    });
  }

  /**
   * Real LIVE contextual sources (regional alerts, weather, satellite observation layers).
   * Do not create aerial tracks.
   */
  getLiveContextualSources(): RegisteredSource[] {
    return Array.from(this.sources.values()).filter(src => {
      if (src.disabled) return false;
      const cap = src.capability.primaryCapability;
      const isContext = cap === "THREAT_ALERT" || cap === "WEATHER" || cap === "EARTH_OBSERVATION";
      if (!isContext) return false;
      return this.getSourceState(src.name) === "LIVE";
    });
  }

  /**
   * Test / Simulation sources (synthetic flight models, demo / test scenarios).
   */
  getTestSources(): RegisteredSource[] {
    return Array.from(this.sources.values()).filter(
      src => src.capability.primaryCapability === "TEST_SIMULATION" || src.capability.capabilities.includes("TEST_SIMULATION")
    );
  }

  /**
   * Offline sources (disabled, unconfigured, or failing connection).
   */
  getOfflineSources(): RegisteredSource[] {
    return Array.from(this.sources.values()).filter(src => {
      if (src.disabled) return true;
      const state = this.getSourceState(src.name);
      return state === "OFFLINE" || state === "STALE";
    });
  }

  hasLivePositionalSource(): boolean {
    return this.getLivePositionalSources().length > 0;
  }
}

export const sourceRegistry = new SourceRegistry();
