import { bearingDegrees, destinationPoint, haversineMeters } from "../domain/geo.js";
import type { CompactTrackPacket, Observation, ThreatLevel, TrackLifecycle, TrackState, TrackDiagnosticReport } from "../domain/types.js";
import type { ProvenanceRecord, SourceFamily } from "../domain/unifiedObservation.js";
import { ImmFilter2D, type ImmResult } from "./immFilter.js";
import { classifyAerialObject } from "./classificationEngine.js";
import { TrackCorrelator } from "./trackCorrelator.js";

interface InternalTrack {
  state: TrackState;
  filter: ImmFilter2D;
  lastMeasurementTime: number;
  firstSeen: number;
  hitsCount: number;
  lastImmResult?: ImmResult;
  lastMahalanobisDistance?: number;
  lastStationarySince?: number;
}

const STALE_AFTER_MS = 15_000; // 15 seconds without fresh measurement = target pruned immediately

export class TrackManager {
  private readonly tracks = new Map<string, InternalTrack>();
  private readonly correlator = new TrackCorrelator();
  private seqNumber = 0;
  private recentlyRemovedIds = new Set<string>();

  getTrack(id: string): TrackState | undefined {
    return this.tracks.get(id)?.state;
  }

  getNextSequence(): number {
    this.seqNumber += 1;
    return this.seqNumber;
  }

  ingest(observation: Observation, now = Date.now()): TrackState | null {
    // Drop outdated observations (older than 25s) to prevent ghost resurrection
    if (now - observation.timestamp > 25_000) {
      return this.tracks.get(observation.id)?.state ?? null;
    }

    // Drop civilian commercial passenger airliners and foreign corridor clutter
    if (observation.type === "aircraft") {
      const callsign = (typeof observation.meta?.callsign === "string" ? observation.meta.callsign : observation.id).toUpperCase();
      const model = (typeof observation.meta?.model === "string" ? observation.meta.model : "").toUpperCase();
      const isCivilAirliner =
        model.includes("BOEING") ||
        model.includes("AIRBUS") ||
        model.includes("CIVIL") ||
        model.includes("EMBRAER") ||
        model.includes("B73") ||
        model.includes("A32") ||
        /^(RYR|WZZ|WUK|LOT|DLH|KLM|AFR|BAW|THY|AUA|SXS|PGT|EZY|BTI|ENT|TOM|FDB|ETH|ROT|CAI|ISR|PIA|FDX|UPS|BOX|CGF|MNB|UTN|LBT|NMA|GJT|ASL|EXS|CCA|SIA|RYS|NSZ)/.test(callsign);
      if (isCivilAirliner) {
        return null;
      }
    }

    const activeList = this.snapshot();
    const correlation = this.correlator.findBestMatch(observation, activeList);

    const targetId = correlation.matchedTrackId ?? observation.id;
    const existing = this.tracks.get(targetId);

    const isSynthetic =
      observation.source === "simulation" ||
      Boolean(observation.meta?.isSynthetic) ||
      Boolean((observation as unknown as { isSynthetic?: boolean }).isSynthetic);
    const syntheticScenario =
      (observation.meta?.syntheticScenario as string) ||
      (observation as unknown as { syntheticScenario?: string }).syntheticScenario;
    const sourceFamily = ((typeof observation.meta?.source_family === "string"
      ? observation.meta.source_family
      : observation.source) as SourceFamily) || "sdr";

    const provenanceEntry: ProvenanceRecord = {
      source: typeof observation.meta?.source_id === "string" ? observation.meta.source_id : observation.source,
      sourceFamily,
      observedAt: observation.timestamp,
      receivedAt: typeof observation.meta?.received_at === "number" ? (observation.meta.received_at as number) : now,
      processedAt: now,
      latencyMs: Math.max(0, now - observation.timestamp),
      confidence: observation.confidence,
      evidence: typeof observation.meta?.evidence === "string" ? [observation.meta.evidence] : [],
      provenanceStr: typeof observation.meta?.provenance === "string" ? observation.meta.provenance : undefined,
      isSynthetic
    };

    if (!existing) {
      const filter = new ImmFilter2D();
      const imm = filter.update(observation.timestamp, observation.lat, observation.lon);
      const effectiveSpeed = observation.speed ?? (imm.speedMs > 2 ? imm.speedMs : 45);
      const effectiveHeading = observation.heading ?? (imm.headingDeg || 0);

      const classification = classifyAerialObject({
        claimedType: observation.type,
        speedMs: effectiveSpeed,
        measuredSpeed: observation.speed,
        altitudeM: observation.altitude,
        measuredAltitude: observation.altitude,
        headingDeg: effectiveHeading,
        modelHint: typeof observation.meta?.model === "string" ? observation.meta.model : undefined,
        callsign: typeof observation.meta?.callsign === "string" ? observation.meta.callsign : undefined,
        sources: [observation.source],
        evidence: typeof observation.meta?.evidence === "string" ? [observation.meta.evidence] : undefined
      });

      // High-quality or multi-sensor source immediately becomes CONFIRMED; others start TENTATIVE
      const isHighConfidence = observation.confidence >= 0.88 || observation.source === "sdr" || isSynthetic;
      const initialLifecycle: TrackLifecycle = isHighConfidence ? "CONFIRMED" : "TENTATIVE";

      const state: TrackState = {
        id: targetId,
        type: classification.resolvedType,
        lat: imm.lat,
        lon: imm.lon,
        heading: effectiveHeading,
        speed: effectiveSpeed,
        timestamp: observation.timestamp,
        confidence: Math.min(1, observation.confidence + correlation.confidenceBonus),
        sources: new Set([observation.source]),
        altitude: classification.estimatedAltitudeM,
        covLat: imm.covLat,
        covLon: imm.covLon,
        uncertaintyRadius: imm.uncertaintyRadiusMeters,
        lastUpdated: now,
        model: classification.resolvedModel,
        alternativeType: classification.alternative?.type,
        alternativeModel: classification.alternative?.model,
        alternativeConfidence: classification.alternative?.confidence,
        callsign: typeof observation.meta?.callsign === "string" ? observation.meta.callsign : undefined,
        lifecycle: initialLifecycle,
        measuredSpeed: classification.isMeasuredSpeed ? observation.speed : undefined,
        measuredAltitude: classification.isMeasuredAltitude ? observation.altitude : undefined,
        measuredLat: observation.lat,
        measuredLon: observation.lon,
        measuredHeading: observation.heading,
        measuredHistory: [[observation.lat, observation.lon, observation.timestamp]],
        evidence: classification.evidence,
        evidenceFamilies: [sourceFamily],
        propulsion: classification.propulsion,
        isSynthetic,
        syntheticScenario,
        provenanceChain: [provenanceEntry]
      };

      this.tracks.set(targetId, {
        state,
        filter,
        lastMeasurementTime: now,
        firstSeen: now,
        hitsCount: 1,
        lastImmResult: imm,
        lastMahalanobisDistance: correlation.mahalanobisDistance
      });
      return state;
    }

    // Existing track: perform IMM update & multi-sensor fusion
    const previous = existing.state;
    const imm = existing.filter.update(observation.timestamp, observation.lat, observation.lon);
    existing.hitsCount += 1;
    existing.lastImmResult = imm;
    existing.lastMahalanobisDistance = correlation.mahalanobisDistance;

    const elapsedSeconds = Math.max((observation.timestamp - previous.timestamp) / 1000, 0.5);
    const distanceMeters = haversineMeters(previous.lat, previous.lon, imm.lat, imm.lon);
    const derivedHeading = distanceMeters > 40
      ? bearingDegrees(previous.lat, previous.lon, imm.lat, imm.lon)
      : (imm.headingDeg || previous.heading);
    const derivedSpeed = distanceMeters / elapsedSeconds;

    const updatedSpeed = observation.speed ?? (derivedSpeed > 10 && derivedSpeed < 1100 ? derivedSpeed : (imm.speedMs || previous.speed));
    const updatedHeading = observation.heading ?? derivedHeading;

    const mergedSources = new Set([...previous.sources, observation.source]);
    const sourceDiversityBonus = mergedSources.size > 1 ? 0.15 : 0;
    const updatedConfidence = Math.min(
      0.99,
      previous.confidence * 0.4 + observation.confidence * 0.5 + sourceDiversityBonus
    );

    const classification = classifyAerialObject({
      claimedType: observation.type !== "unknown" ? observation.type : previous.type,
      speedMs: updatedSpeed,
      measuredSpeed: observation.speed ?? previous.measuredSpeed,
      altitudeM: observation.altitude ?? previous.altitude,
      measuredAltitude: observation.altitude ?? previous.measuredAltitude,
      headingDeg: updatedHeading,
      modelHint: typeof observation.meta?.model === "string" ? observation.meta.model : previous.model,
      callsign: typeof observation.meta?.callsign === "string" ? observation.meta.callsign : previous.callsign,
      sources: Array.from(mergedSources),
      evidence: previous.evidence
    });

    // Lifecycle promotion: 2 hits confirms tentative tracks
    const updatedLifecycle: TrackLifecycle = existing.hitsCount >= 2 ? "CONFIRMED" : previous.lifecycle || "CONFIRMED";

    // Update measured history ring buffer (keep last 5 measured points)
    const updatedHistory = previous.measuredHistory ? [...previous.measuredHistory] : [];
    updatedHistory.push([observation.lat, observation.lon, observation.timestamp]);
    if (updatedHistory.length > 5) updatedHistory.shift();

    // Update provenance chain ring buffer (keep last 8 entries)
    const updatedProvenance = previous.provenanceChain ? [provenanceEntry, ...previous.provenanceChain] : [provenanceEntry];
    if (updatedProvenance.length > 8) updatedProvenance.pop();

    const mergedFamilies = new Set([...(previous.evidenceFamilies || []), sourceFamily]);

    existing.lastMeasurementTime = now;
    existing.state = {
      ...previous,
      type: classification.resolvedType,
      lat: imm.lat,
      lon: imm.lon,
      heading: Math.round(updatedHeading * 10) / 10,
      speed: Math.round(updatedSpeed * 10) / 10,
      altitude: classification.estimatedAltitudeM,
      timestamp: observation.timestamp,
      confidence: Math.round(updatedConfidence * 100) / 100,
      sources: mergedSources,
      covLat: imm.covLat,
      covLon: imm.covLon,
      uncertaintyRadius: Math.round(imm.uncertaintyRadiusMeters),
      lastUpdated: now,
      model: classification.resolvedModel,
      alternativeType: classification.alternative?.type,
      alternativeModel: classification.alternative?.model,
      alternativeConfidence: classification.alternative?.confidence,
      callsign: typeof observation.meta?.callsign === "string" ? observation.meta.callsign : previous.callsign,
      lifecycle: updatedLifecycle,
      measuredSpeed: classification.isMeasuredSpeed ? (observation.speed ?? previous.measuredSpeed) : undefined,
      measuredAltitude: classification.isMeasuredAltitude ? (observation.altitude ?? previous.measuredAltitude) : undefined,
      measuredLat: observation.lat,
      measuredLon: observation.lon,
      measuredHeading: observation.heading ?? previous.measuredHeading,
      measuredHistory: updatedHistory,
      evidence: classification.evidence,
      evidenceFamilies: Array.from(mergedFamilies),
      propulsion: classification.propulsion,
      isSynthetic: previous.isSynthetic || isSynthetic,
      syntheticScenario: previous.syntheticScenario || syntheticScenario,
      provenanceChain: updatedProvenance
    };

    return existing.state;
  }

  removeTrack(id: string): boolean {
    this.recentlyRemovedIds.add(id);
    return this.tracks.delete(id);
  }

  tick(now = Date.now()): void {
    for (const [, entry] of this.tracks.entries()) {
      const dt = Math.max(0, (now - entry.state.timestamp) / 1000);
      const timeSinceLastMeasurement = now - entry.lastMeasurementTime;

      // Lifecycle status transitions
      if (timeSinceLastMeasurement > 5_000 && entry.state.lifecycle === "CONFIRMED") {
        entry.state.lifecycle = "COASTING";
      } else if (timeSinceLastMeasurement > 12_000 && entry.state.lifecycle === "COASTING") {
        entry.state.lifecycle = "STALE";
      }

      if (dt <= 0.1) {
        continue;
      }

      // Kinematic dead-reckoning extrapolation
      if (entry.state.speed > 2 && entry.state.heading !== undefined) {
        const dist = entry.state.speed * dt;
        const nextPos = destinationPoint(entry.state.lat, entry.state.lon, entry.state.heading, dist);
        entry.state.lat = Math.round(nextPos.lat * 1_000_000) / 1_000_000;
        entry.state.lon = Math.round(nextPos.lon * 1_000_000) / 1_000_000;
        entry.state.timestamp = now;

        // Coasting targets slightly increase uncertainty radius
        if (entry.state.lifecycle === "COASTING" && entry.state.uncertaintyRadius) {
          entry.state.uncertaintyRadius = Math.min(8000, entry.state.uncertaintyRadius + Math.round(dt * 15));
        }
      }
    }
  }

  prune(now = Date.now()): void {
    for (const [id, entry] of this.tracks.entries()) {
      const measurementAge = now - entry.lastMeasurementTime;

      // 1. Drop unconfirmed tentative tracks if no follow-up hit within 10s
      if (entry.state.lifecycle === "TENTATIVE" && measurementAge > 10_000) {
        this.removeTrack(id);
        continue;
      }

      // 2. Stale measurement timeout (15 seconds without fresh measurement data)
      if (measurementAge > STALE_AFTER_MS) {
        this.removeTrack(id);
        continue;
      }

      const type = entry.state.type;
      const ageMs = now - entry.firstSeen;

      // 3. Maximum physical flight persistence limit per weapon/aircraft type
      const maxLifetimeMs =
        type === "bomb"
          ? 240_000 // 4 min max for glide bomb
          : type === "fpv"
          ? 360_000 // 6 min max for FPV quadcopter battery
          : type === "munition"
          ? 720_000 // 12 min max for cruise/ballistic missile flight phase
          : type === "uav"
          ? 2_400_000 // 40 min max for Shahed / recon drone in a single sector
          : 18_000_000; // 5 hours max for aircraft with active transponder

      if (ageMs > maxLifetimeMs) {
        this.removeTrack(id);
        continue;
      }

      // 4. Stationary target detection: airborne weapons and tactical aircraft cannot hover motionless
      const isStationary = entry.state.speed < 4.0; // < 14 km/h
      if (isStationary) {
        if (!entry.lastStationarySince) {
          entry.lastStationarySince = now;
        }

        const stationaryDurationMs = now - entry.lastStationarySince;

        // Bombs, FPVs and missiles cannot hover at all
        if (type === "bomb" || type === "fpv" || type === "munition") {
          this.removeTrack(id);
          continue;
        }

        // UAVs cannot stay stationary for > 45 seconds
        if (type === "uav" && stationaryDurationMs > 45_000) {
          this.removeTrack(id);
          continue;
        }

        // Helicopters / aircraft stationary for > 90 seconds are grounded or invalid transponder
        if ((type === "helicopter" || type === "aircraft") && stationaryDurationMs > 90_000) {
          this.removeTrack(id);
          continue;
        }
      } else {
        entry.lastStationarySince = undefined;
      }
    }
  }

  snapshot(includeSynthetic = true): TrackState[] {
    const list: TrackState[] = [];
    for (const entry of this.tracks.values()) {
      if (!includeSynthetic && entry.state.isSynthetic) {
        continue;
      }
      list.push(entry.state);
    }
    return list;
  }

  toPackets(includeSynthetic = true): CompactTrackPacket[] {
    return this.snapshot(includeSynthetic)
      .filter((track) => track.lifecycle !== "TENTATIVE" || track.confidence >= 0.85)
      .map((track) => [
        track.id,
        track.type,
        Math.round(track.lat * 1_000_000) / 1_000_000,
        Math.round(track.lon * 1_000_000) / 1_000_000,
        Math.round(track.heading * 100) / 100,
        Math.round(track.speed * 100) / 100,
        track.timestamp,
        track.confidence,
        track.uncertaintyRadius,
        track.threatLevel,
        track.altitude,
        track.model,
        track.callsign
      ]);
  }

  /**
   * Generates delta updates since last cycle
   */
  getDeltaPacket(includeSynthetic = true): {
    seq: number;
    tracks: CompactTrackPacket[];
    removedIds: string[];
  } {
    const seq = this.getNextSequence();
    const tracks = this.toPackets(includeSynthetic);
    const removedIds = Array.from(this.recentlyRemovedIds);
    this.recentlyRemovedIds.clear();

    return { seq, tracks, removedIds };
  }

  /**
   * Diagnostic lookup for a single track
   */
  getTrackDiagnostic(id: string): TrackDiagnosticReport | null {
    const entry = this.tracks.get(id);
    if (!entry) return null;

    const t = entry.state;
    const imm = entry.lastImmResult;

    const deltaMeters =
      t.measuredLat !== undefined && t.measuredLon !== undefined
        ? Math.round(haversineMeters(t.measuredLat, t.measuredLon, t.lat, t.lon))
        : null;

    return {
      id: t.id,
      lifecycle: t.lifecycle ?? "CONFIRMED",
      hitsCount: entry.hitsCount,
      firstSeen: entry.firstSeen,
      lastMeasurementTime: entry.lastMeasurementTime,
      ageSec: Math.round((Date.now() - entry.firstSeen) / 1000),
      isSynthetic: Boolean(t.isSynthetic),
      classification: {
        type: t.type,
        model: t.model,
        propulsion: t.propulsion,
        confidence: t.confidence,
        evidence: t.evidence ?? [],
        evidenceFamilies: t.evidenceFamilies ?? []
      },
      kinematics: {
        estimated: {
          lat: t.lat,
          lon: t.lon,
          speedKmh: Math.round(t.speed * 3.6),
          speedMs: t.speed,
          heading: t.heading,
          altitudeM: t.altitude
        },
        measured: {
          lat: t.measuredLat,
          lon: t.measuredLon,
          speedKmh: t.measuredSpeed !== undefined ? Math.round(t.measuredSpeed * 3.6) : null,
          altitudeM: t.measuredAltitude,
          heading: t.measuredHeading,
          deltaFromEstimatedMeters: deltaMeters ?? 0
        },
        uncertaintyRadiusMeters: t.uncertaintyRadius
      },
      filter: {
        immActiveModel: imm?.activeModel ?? "CV",
        cvProbability: imm?.cvProbability ?? 0.65,
        ctProbability: imm?.ctProbability ?? 0.35,
        covLat: t.covLat,
        covLon: t.covLon,
        lastMahalanobisDistance: entry.lastMahalanobisDistance
      },
      measuredHistory: t.measuredHistory ?? [],
      provenanceChain: t.provenanceChain ?? []
    };
  }
}
