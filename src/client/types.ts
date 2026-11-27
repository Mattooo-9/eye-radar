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

export interface ClientAlertDetail {
  name: string;
  startedAt?: number;
  changedAt?: string;
}

export interface ClientAlertHistoryItem {
  oblast: string;
  eventType: "alert_start" | "alert_clear";
  source: string;
  recordedAt: number;
}

export interface ClientAlertState {
  activeAlerts: string[];
  alertDetails?: Record<string, ClientAlertDetail>;
  history?: ClientAlertHistoryItem[];
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
