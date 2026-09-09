export type TrackType =
  | "unknown"
  | "aircraft"
  | "helicopter"
  | "uav"
  | "munition"
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

// Compact packet: [id, type, lat, lon, heading, speed, timestamp, confidence, uncertaintyRadius, threatLevel, altitude]
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
  altitude?: number
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
}
