import { bearingDegrees, haversineMeters } from "../domain/geo.js";
import type { TrackState, UserAlertPreference } from "../domain/types.js";

export type ThreatState = "NEW" | "APPROACHING" | "CRITICAL" | "PASSED" | "CLEARED";

export interface TrackAlertEvaluation {
  trackId: string;
  chatId: number;
  state: ThreatState;
  previousState?: ThreatState;
  shouldNotify: boolean;
  reason: string;
  distanceKm: number;
  etaMinutes: number | null;
  bearingDeg: number;
  speedKmh: number;
  targetModel: string;
  targetType: string;
}

export interface TrackStateRecord {
  chatId: number;
  trackId: string;
  state: ThreatState;
  previousState?: ThreatState;
  lastNotifiedAt: number;
  lastStateChangeAt: number;
  lastDistanceKm: number;
  lastHeadingDeg: number;
  consecutiveDivergingCount: number;
  lastEvaluatedAt: number;
}

export const COOLDOWN_PER_TRACK_MS = 60_000; // 60s cooldown between notifications for same track

export class AlertStateMachine {
  private lifecycles = new Map<string, TrackStateRecord>();

  private getKey(chatId: number, trackId: string): string {
    return `${chatId}:${trackId}`;
  }

  evaluateTrack(
    pref: UserAlertPreference,
    track: TrackState,
    now = Date.now()
  ): TrackAlertEvaluation {
    const key = this.getKey(pref.chatId, track.id);
    const existing = this.lifecycles.get(key);

    const distMeters = haversineMeters(
      track.lat,
      track.lon,
      pref.lat,
      pref.lon
    );
    const distanceKm = Math.round((distMeters / 1000) * 10) / 10;
    const bearing = Math.round(bearingDegrees(track.lat, track.lon, pref.lat, pref.lon));
    const speedKmh = Math.round(track.speed * 3.6);

    // Calculate angular divergence between track heading and bearing to user
    const headingDiff = Math.abs(bearing - track.heading);
    const angularDivergence = Math.min(headingDiff, 360 - headingDiff);
    const isClosing = angularDivergence <= 65 && track.speed > 5;

    // Calculate effective closing speed along user line-of-sight
    const closingSpeedMs = isClosing ? track.speed * Math.cos((angularDivergence * Math.PI) / 180) : 0;
    const etaMinutes = closingSpeedMs > 3 ? Math.round((distMeters / closingSpeedMs / 60) * 10) / 10 : null;

    let previousState: ThreatState | undefined = existing?.state;
    let consecutiveDiverging = existing?.consecutiveDivergingCount ?? 0;
    if (existing && distanceKm > existing.lastDistanceKm + 0.5) {
      consecutiveDiverging++;
    } else if (existing && distanceKm < existing.lastDistanceKm - 0.5) {
      consecutiveDiverging = 0;
    }

    // Determine state transition based on geometry and kinematics
    let nextState: ThreatState = "NEW";

    if (distanceKm > pref.radiusKm + 25) {
      nextState = "CLEARED";
    } else if (distanceKm <= 5.0 || (etaMinutes !== null && etaMinutes <= 2.0 && distanceKm <= 8.0 && isClosing)) {
      nextState = "CRITICAL";
    } else if (
      (previousState === "CRITICAL" || previousState === "APPROACHING") &&
      (angularDivergence > 90 || consecutiveDiverging >= 2) &&
      distanceKm > 4.0
    ) {
      nextState = "PASSED";
    } else if (distanceKm <= Math.min(pref.radiusKm, 18.0) && (isClosing || (etaMinutes !== null && etaMinutes <= 8.0))) {
      nextState = "APPROACHING";
    } else if (distanceKm <= pref.radiusKm + 10.0) {
      nextState = "NEW";
    } else {
      nextState = "CLEARED";
    }

    // Evaluate notification decision
    let shouldNotify = false;
    let reason = "no_change";
    const lastNotified = existing?.lastNotifiedAt ?? 0;
    const cooldownElapsed = now - lastNotified >= COOLDOWN_PER_TRACK_MS;

    if (!existing) {
      // First time tracking this target for this user
      if (nextState === "CRITICAL" || nextState === "APPROACHING") {
        shouldNotify = true;
        reason = `initial_${nextState.toLowerCase()}`;
      } else {
        reason = "initial_new_silent";
      }
    } else if (nextState !== previousState) {
      // State transition occurred
      if (nextState === "CRITICAL") {
        shouldNotify = cooldownElapsed;
        reason = "transition_to_critical";
      } else if (nextState === "APPROACHING") {
        shouldNotify = cooldownElapsed;
        reason = "transition_to_approaching";
      } else if (nextState === "PASSED" && (previousState === "CRITICAL" || previousState === "APPROACHING")) {
        shouldNotify = cooldownElapsed;
        reason = "transition_to_passed";
      } else if (nextState === "CLEARED" && (previousState === "CRITICAL" || previousState === "APPROACHING" || previousState === "PASSED")) {
        shouldNotify = cooldownElapsed;
        reason = "transition_to_cleared";
      } else {
        reason = `silent_transition_${previousState}_to_${nextState}`;
      }
    } else if (nextState === "CRITICAL" && existing) {
      // Threshold crossing within CRITICAL (e.g. closed down from 5km to under 2km)
      if (existing.lastDistanceKm > 2.5 && distanceKm <= 2.0 && cooldownElapsed) {
        shouldNotify = true;
        reason = "critical_immediate_threshold_crossed";
      } else {
        reason = "dedup_critical_cooldown";
      }
    } else {
      reason = "dedup_state_unchanged";
    }

    const stateRecord: TrackStateRecord = {
      chatId: pref.chatId,
      trackId: track.id,
      state: nextState,
      previousState,
      lastNotifiedAt: shouldNotify ? now : lastNotified,
      lastStateChangeAt: nextState !== previousState ? now : (existing?.lastStateChangeAt ?? now),
      lastDistanceKm: distanceKm,
      lastHeadingDeg: track.heading,
      consecutiveDivergingCount: consecutiveDiverging,
      lastEvaluatedAt: now
    };

    this.lifecycles.set(key, stateRecord);

    return {
      trackId: track.id,
      chatId: pref.chatId,
      state: nextState,
      previousState,
      shouldNotify,
      reason,
      distanceKm,
      etaMinutes,
      bearingDeg: bearing,
      speedKmh,
      targetModel: track.model || track.type.toUpperCase(),
      targetType: track.type
    };
  }

  /**
   * Evaluates active tracks for all preferences, cleans up obsolete targets, and returns notifications
   */
  evaluateAll(
    preferences: UserAlertPreference[],
    activeTracks: TrackState[],
    now = Date.now()
  ): TrackAlertEvaluation[] {
    const notifications: TrackAlertEvaluation[] = [];
    const activeTrackIds = new Set(activeTracks.map((t) => t.id));

    for (const pref of preferences) {
      if (!pref.enabled) continue;

      for (const track of activeTracks) {
        // Evaluate only aerial threats or high-speed targets
        if (track.threatLevel === "critical" || track.threatLevel === "high" || track.type === "uav" || track.type === "munition") {
          const evalResult = this.evaluateTrack(pref, track, now);
          if (evalResult.shouldNotify) {
            notifications.push(evalResult);
          }
        }
      }
    }

    // Clean up stale lifecycle records older than 15 minutes or tracks that disappeared
    for (const [key, record] of this.lifecycles.entries()) {
      if (now - record.lastEvaluatedAt > 15 * 60_000 || (!activeTrackIds.has(record.trackId) && record.state === "CLEARED")) {
        this.lifecycles.delete(key);
      }
    }

    return notifications;
  }

  getRecord(chatId: number, trackId: string): TrackStateRecord | undefined {
    return this.lifecycles.get(this.getKey(chatId, trackId));
  }

  reset(): void {
    this.lifecycles.clear();
  }
}

export const alertStateMachine = new AlertStateMachine();
