// src/client/types.ts
export interface FilterState {
  uav: boolean;
  munition: boolean;
  aircraft: boolean;
  helicopter?: boolean;
  bomb?: boolean;
  fpv?: boolean;
  sound: boolean;
}

export type AlertFeedStatus = "fresh" | "stale" | "unavailable";

export interface ClientAlertState {
  activeAlerts: string[];
  status: AlertFeedStatus;
  source: string;
  sourceAvailable: boolean;
  lastConfirmedAt: number | null;
}

export interface TacticalFilters {
  autoTracking: boolean;
  minSpeedKmh: number;
  maxSpeedKmh: number;
  threatOnly: boolean;
  dangerRadiusKm: number;
  showWind: boolean;
}
