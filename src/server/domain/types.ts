export type TrackType =
  | "unknown"
  | "aircraft"
  | "helicopter"
  | "uav"
  | "munition"
  | "bomb"
  | "fpv"
  | "thermal";

export type SourceKind =
  | "osint"
  | "sdr"
  | "alerts"
  | "firms"
  | "weather"
  | "manual"
  | "simulation";

export type ThreatLevel = "low" | "medium" | "high" | "critical";

export interface ImpactEvent {
  id: string;
  type: "impact" | "intercept"; // "приліт" | "збиття"
  lat: number;
  lon: number;
  timestamp: number;
  targetModel: string;
  targetType: TrackType;
  region: string;
  details?: string;
}

// Compact packet: [id, type, lat, lon, heading, speed, timestamp, confidence, uncertaintyRadius, threatLevel, altitude, model, callsign]
export type CompactTrackPacket = [
  id: string,
  type: TrackType,
  lat: number,
  lon: number,
  heading: number,
  speed: number,
  timestamp: number,
  confidence?: number,
  uncertaintyRadius?: number,
  threatLevel?: ThreatLevel,
  altitude?: number,
  model?: string,
  callsign?: string
];

export interface Observation {
  id: string;
  type: TrackType;
  lat: number;
  lon: number;
  heading?: number;
  speed?: number;
  timestamp: number;
  source: SourceKind;
  confidence: number;
  altitude?: number;
  meta?: Record<string, string | number | boolean>;
}

export type TrackLifecycle = "TENTATIVE" | "CONFIRMED" | "COASTING" | "STALE" | "EXPIRED";

export interface TrackState {
  id: string;
  type: TrackType;
  lat: number;
  lon: number;
  heading: number;
  speed: number;
  timestamp: number;
  confidence: number;
  sources: Set<SourceKind>;
  altitude?: number;
  covLat?: number;
  covLon?: number;
  uncertaintyRadius?: number;
  threatLevel?: ThreatLevel;
  lastUpdated?: number;
  model?: string;
  alternativeType?: TrackType;
  alternativeModel?: string;
  alternativeConfidence?: number;
  callsign?: string;
  lifecycle?: TrackLifecycle;
  measuredSpeed?: number;
  measuredAltitude?: number;
  measuredLat?: number;
  measuredLon?: number;
  measuredHeading?: number;
  measuredHistory?: Array<[lat: number, lon: number, timestamp: number]>;
  evidence?: string[];
  evidenceFamilies?: string[];
  propulsion?: string;
  isSynthetic?: boolean;
  provenanceChain?: Array<{
    source: string;
    sourceFamily: string;
    observedAt: number;
    receivedAt: number;
    processedAt: number;
    latencyMs: number;
    confidence: number;
    evidence: string[];
    provenanceStr?: string;
    isSynthetic?: boolean;
  }>;
  syntheticScenario?: string;
}

export interface TrackDiagnosticReport {
  id: string;
  lifecycle: TrackLifecycle;
  hitsCount: number;
  firstSeen: number;
  lastMeasurementTime: number;
  ageSec: number;
  isSynthetic: boolean;
  classification: {
    type: TrackType;
    model?: string;
    propulsion?: string;
    confidence: number;
    evidence: string[];
    evidenceFamilies: string[];
  };
  kinematics: {
    estimated: {
      lat: number;
      lon: number;
      speedKmh: number;
      speedMs: number;
      heading: number;
      altitudeM?: number;
    };
    measured: {
      lat?: number;
      lon?: number;
      speedKmh: number | null;
      altitudeM?: number;
      heading?: number;
      deltaFromEstimatedMeters: number;
    };
    uncertaintyRadiusMeters?: number;
  };
  filter: {
    immActiveModel: string;
    cvProbability: number;
    ctProbability: number;
    covLat?: number;
    covLon?: number;
    lastMahalanobisDistance?: number;
  };
  measuredHistory: Array<[lat: number, lon: number, timestamp: number]>;
  provenanceChain: Array<{
    source: string;
    sourceFamily: string;
    observedAt: number;
    receivedAt: number;
    processedAt: number;
    latencyMs: number;
    confidence: number;
    evidence: string[];
    provenanceStr?: string;
    isSynthetic?: boolean;
  }>;
}

export interface UserLocation {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
}

export interface ClientSession {
  userId: string;
  location?: UserLocation;
  trustScore: number;
  anomalyFlags: string[];
}

export interface AlertRegion {
  id: string;
  name: string;
  active: boolean;
  type: "oblast" | "raion" | "city";
  updatedAt: number;
}

export interface UserAlertPreference {
  chatId: number;
  lat: number;
  lon: number;
  radiusKm: number;
  enabled: boolean;
  lastNotified?: number;
  cityName?: string;
  lastAlertState?: boolean;
}

