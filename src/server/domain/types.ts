export type TrackType = "unknown" | "aircraft" | "helicopter" | "uav" | "munition";
export type SourceKind = "osint" | "sdr" | "manual";

export type CompactTrackPacket = [
  id: string,
  type: TrackType,
  lat: number,
  lon: number,
  heading: number,
  speed: number,
  timestamp: number
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
