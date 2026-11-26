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

export interface TacticalFilters {
  autoTracking: boolean;
  minSpeedKmh: number;
  maxSpeedKmh: number;
  threatOnly: boolean;
  dangerRadiusKm: number;
  showWind: boolean;
}
