import type { SourceRegistry } from "../sources/SourceRegistry.js";
import { sourceRegistry as globalSourceRegistry } from "../sources/SourceRegistry.js";
import { bearingDegrees, destinationPoint, haversineMeters } from "../domain/geo.js";
import type { CompactTrackPacket, Observation, ThreatLevel, TrackLifecycle, TrackState, TrackDiagnosticReport } from "../domain/types.js";
import type { ProvenanceRecord, SourceFamily } from "../domain/unifiedObservation.js";
import { ImmFilter2D, type ImmResult } from "./immFilter.js";
import { classifyAerialObject } from "./classificationEngine.js";
import { TrackCorrelator } from "./trackCorrelator.js";
import { encodeBinaryDelta, encodeBinarySnapshot } from "../../common/binaryCodec.js";
import { timeCalibrationService } from "./timeCalibration.js";
import { UKRAINE_CITIES } from "../sources/ukraineGeo.js";
import { productionObservability } from "./observability.js";
import { uncertaintyEventManager } from "./uncertaintyEventManager.js";

export function findNearestOblast(lat: number, lon: number): { nameUk: string; oblast: string } {
  let minD = Infinity;
  let closest = UKRAINE_CITIES.kyiv;
  for (const c of Object.values(UKRAINE_CITIES)) {
    const d = (c.lat - lat) ** 2 + (c.lon - lon) ** 2;
    if (d < minD) {
      minD = d;
      closest = c;
    }
  }
  return { nameUk: closest.nameUk, oblast: closest.oblast || closest.nameUk };
}

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

const STALE_AFTER_MS = 45_000; // 45 seconds without fresh measurement = target pruned

export class TrackManager {
  private readonly sourceRegistry: SourceRegistry;
  constructor(sourceRegistry?: SourceRegistry) {
    this.sourceRegistry = sourceRegistry ?? globalSourceRegistry;
  }
  private readonly tracks = new Map<string, InternalTrack>();
  private readonly correlator = new TrackCorrelator();
  private seqNumber = 0;
  private recentlyRemovedIds = new Set<string>();
  private readonly recentObsFingerprints = new Set<string>();
  private readonly lastPublishedState = new Map<string, CompactTrackPacket>();
  private activeAlertOblasts = new Set<string>();

  setActiveAlertOblasts(oblasts: string[]): void {
    this.activeAlertOblasts = new Set(
      oblasts.map((o) => o.toLowerCase().replace("область", "").replace("обл.", "").trim())
    );
    this.runRegionalSanityCheck();
  }

  getActiveAlertOblasts(): string[] {
    return Array.from(this.activeAlertOblasts);
  }

  runRegionalSanityCheck(): void {
    if (this.activeAlertOblasts.size === 0) return;
    for (const [id, entry] of this.tracks.entries()) {
      const track = entry.state;
      const nearest = findNearestOblast(track.lat, track.lon);
      const regionKey = nearest.oblast.toLowerCase().replace("область", "").replace("обл.", "").trim();
      const regionUkKey = nearest.nameUk.toLowerCase();

      const hasActiveAlert = Array.from(this.activeAlertOblasts).some(
        (alertName) =>
          alertName.includes(regionKey) ||
          regionKey.includes(alertName) ||
          alertName.includes(regionUkKey) ||
          regionUkKey.includes(alertName)
      );

      // Synthetic tracks in unalarmed regions MUST be purged immediately
      if (track.isSynthetic && !hasActiveAlert) {
        this.removeTrack(id);
        continue;
      }

      this.applySanityCheckToTrack(track);
    }
  }

  applySanityCheckToTrack(track: TrackState): void {
    const isCombatType =
      track.type === "uav" ||
      track.type === "munition" ||
      track.type === "bomb" ||
      track.type === "fpv";

    if (!isCombatType) return;

    // Check for independent threat evidence
    const hasIndependentThreatEvidence =
      (track.threatEvidence && track.threatEvidence.length > 0) ||
      (track.evidence &&
        track.evidence.some(
          (e) =>
            e.startsWith("acoustic_") ||
            e.startsWith("optical_") ||
            e.startsWith("radar_") ||
            e.startsWith("threat_")
        )) ||
      Boolean(track.isSynthetic);

    if (hasIndependentThreatEvidence) {
      return;
    }

    const nearest = findNearestOblast(track.lat, track.lon);
    const regionKey = nearest.oblast.toLowerCase().replace("область", "").replace("обл.", "").trim();
    const regionUkKey = nearest.nameUk.toLowerCase();

    const hasActiveAlert = Array.from(this.activeAlertOblasts).some(
      (alertName) =>
        alertName.includes(regionKey) ||
        regionKey.includes(alertName) ||
        alertName.includes(regionUkKey) ||
        regionUkKey.includes(alertName)
    );

    // If NO active alert in the region AND NO independent threat evidence:
    // Sanity check triggers: automatically reduce combat classConfidence to UNKNOWN
    if (!hasActiveAlert) {
      track.type = "unknown";
      if (!track.ewFlags?.includes("impossible_jump_rejected")) {
        track.model = "Невідома повітряна ціль (тривога відсутня)";
      }
      track.classConfidence = Math.min(track.classConfidence || 0.4, 0.25);
      track.alternativeType = "unknown";
      track.alternativeModel = "Непідтверджена загроза";
      track.alternativeConfidence = 0.15;
      if (!track.classEvidence) track.classEvidence = [];
      if (!track.classEvidence.includes("sanity_check_no_alert_demoted_to_unknown")) {
        track.classEvidence.push("sanity_check_no_alert_demoted_to_unknown");
      }
    }
  }

  getTrack(id: string): TrackState | undefined {
    return this.tracks.get(id)?.state;
  }

  getSequence(): number {
    return this.seqNumber;
  }

  setSequence(seq: number): void {
    this.seqNumber = Math.max(this.seqNumber, seq);
  }

  getNextSequence(): number {
    this.seqNumber += 1;
    return this.seqNumber;
  }

  restoreFromCheckpoint(checkpoint: { sequenceId: number; tracks: TrackState[]; timestamp?: number }): number {
    this.seqNumber = Math.max(this.seqNumber, checkpoint.sequenceId || 0);
    const baseTime = checkpoint.timestamp || Date.now();
    let restoredCount = 0;

    for (const t of checkpoint.tracks) {
      if (!t.id || typeof t.lat !== "number" || typeof t.lon !== "number") continue;
      const filter = new ImmFilter2D();
      filter.update(t.timestamp || baseTime, t.lat, t.lon);

      this.tracks.set(t.id, {
        state: t,
        filter,
        lastMeasurementTime: t.timestamp || baseTime,
        firstSeen: (t as any).firstSeen || t.timestamp || baseTime,
        hitsCount: (t as any).hitsCount || 1
      });

      const packet: CompactTrackPacket = [
        t.id,
        t.type,
        t.lat,
        t.lon,
        t.heading,
        t.speed,
        t.timestamp,
        t.confidence,
        t.uncertaintyRadius,
        t.threatLevel,
        t.altitude,
        t.model,
        t.callsign
      ];
      this.lastPublishedState.set(t.id, packet);
      restoredCount++;
    }

    console.log(`🚀 TrackManager: restored ${restoredCount} tracks at sequence ${this.seqNumber} from checkpoint`);
    return restoredCount;
  }

  ingest(observation: Observation, now = Date.now()): TrackState | null {
    productionObservability.recordObservationReceived(1);

    // Evidence Gating: ensure observation evidence types are allowed by source capabilities
    const srcReg = this.sourceRegistry.get(observation.source) ||
      (typeof observation.meta?.source_id === "string" ? this.sourceRegistry.get(observation.meta.source_id as string) : undefined);
    if (srcReg?.capability?.evidenceTypes?.length) {
      const evidenceList = typeof observation.meta?.evidence === "string"
        ? [observation.meta.evidence]
        : Array.isArray(observation.meta?.evidence)
        ? observation.meta.evidence
        : [];
      const disallowed = evidenceList.filter(e => {
        return !srcReg.capability.evidenceTypes.some(allowed =>
          e === allowed || e.startsWith(`${allowed}_`) || e.startsWith(allowed) || e.includes(allowed)
        );
      });
      // If observation claims unauthorized combat/sensor threat evidence (e.g. pure ADS-B claiming acoustic/radar), reject
      const hasDisallowedThreat = disallowed.some(d =>
        d.startsWith("threat_") || d.startsWith("acoustic_") || d.startsWith("radar_") || d.startsWith("optical_")
      );
      if (hasDisallowedThreat) {
        productionObservability.recordObservationRejected("disallowed_threat_evidence", 1);
        return null;
      }
    }

    // Source Time Calibration: measure clock offset, jitter, latency, and adjust observedAt
    const srcId = (typeof observation.meta?.source_id === "string" ? observation.meta.source_id : observation.source) || "unknown";
    const recAt = typeof observation.meta?.received_at === "number" ? (observation.meta.received_at as number) : now;
    const pubAt = typeof (observation.meta as any)?.published_at === "number" ? ((observation.meta as any).published_at as number) : undefined;
    const { calibratedTime, metrics: timeMetrics } = timeCalibrationService.recordAndCalibrate(srcId, observation.timestamp, recAt, pubAt);
    observation.timestamp = calibratedTime;
    if (observation.meta) {
      (observation.meta as any).time_confidence = timeMetrics.timeConfidence;
      (observation.meta as any).calibrated_latency_ms = timeMetrics.p50LatencyMs;
    }

    // Drop outdated observations (older than 25s) to prevent ghost resurrection
    if (now - observation.timestamp > 25_000) {
      productionObservability.recordObservationRejected("outdated_timestamp", 1);
      return this.tracks.get(observation.id)?.state ?? null;
    }

    // Pre-fusion observation deduplication
    const fingerprint = `${observation.source}:${observation.id}:${observation.timestamp}`;
    if (this.recentObsFingerprints.has(fingerprint)) {
      productionObservability.recordObservationRejected("deduplicated", 1);
      return this.tracks.get(observation.id)?.state ?? null;
    }
    if (this.recentObsFingerprints.size >= 3000) {
      this.recentObsFingerprints.clear();
    }
    this.recentObsFingerprints.add(fingerprint);

    // Capability Matrix Gating: Each source can ONLY influence its authorized capabilities
    const regSource = srcReg;
    if (regSource) {
      // If source cannot provide position AND cannot create track, route to Layer 2 (Uncertainty Events)
      if (!regSource.capability.canProvidePosition && !regSource.capability.canCreateTrack) {
        uncertaintyEventManager.ingestObservation(observation, now);
        productionObservability.recordObservationAccepted(1);
        return null;
      }
      if (!regSource.capability.canProvideAltitude) {
        observation.altitude = undefined;
      }
      if (!regSource.capability.canProvideSpeed) {
        observation.speed = undefined;
      }
      if (!regSource.capability.canClassify && observation.type !== "thermal") {
        if (observation.type !== "aircraft" && observation.type !== "helicopter") {
          observation.type = "unknown";
        }
      }
    }

    // Real civilian passenger aircraft or corridor flights: retain in positional track table as AIRCRAFT / UNKNOWN
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
        observation.threatEvidence = [];
        if (!observation.meta) observation.meta = {};
        observation.meta.threatEvidence = [];
        delete observation.meta.threatLevel;
      }
    }

    productionObservability.recordObservationAccepted(1);

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
    const sourceId = (typeof observation.meta?.source_id === "string" ? observation.meta.source_id : observation.source).toLowerCase();
    let sourceFamily: SourceFamily = "adsb";
    if (sourceId.includes("adsb") || sourceId.includes("airplanes") || sourceId.includes("opensky")) {
      sourceFamily = "adsb"; // Unified ADS-B / MLAT family
    } else if (sourceId.includes("alert")) {
      sourceFamily = "alert";
    } else if (sourceId.includes("meteo") || sourceId.includes("weather")) {
      sourceFamily = "weather";
    } else if (sourceId.includes("firms") || sourceId.includes("copernicus") || sourceId.includes("observation")) {
      sourceFamily = "optical";
    } else if (sourceId.includes("simulation") || observation.source === "simulation") {
      sourceFamily = "simulation";
    } else if (sourceId.includes("osint") || observation.source === "osint") {
      sourceFamily = "osint";
    } else if (sourceId.includes("sdr") || observation.source === "sdr") {
      sourceFamily = "radar";
    } else if (typeof observation.meta?.source_family === "string") {
      sourceFamily = observation.meta.source_family as SourceFamily;
    }

    const timeConf = typeof (observation.meta as any)?.time_confidence === "number" ? ((observation.meta as any).time_confidence as number) : 1.0;
    const provenanceEntry: ProvenanceRecord = {
      source: typeof observation.meta?.source_id === "string" ? observation.meta.source_id : observation.source,
      sourceFamily,
      observedAt: observation.timestamp,
      receivedAt: typeof observation.meta?.received_at === "number" ? (observation.meta.received_at as number) : now,
      processedAt: now,
      latencyMs: Math.max(0, now - observation.timestamp),
      confidence: Math.round(observation.confidence * (0.8 + 0.2 * timeConf) * 100) / 100,
      evidence: typeof observation.meta?.evidence === "string" ? [observation.meta.evidence] : [],
      provenanceStr: typeof observation.meta?.provenance === "string" ? observation.meta.provenance : undefined,
      isSynthetic
    };

    if (!existing) {
      const filter = new ImmFilter2D();
      const imm = filter.update(observation.timestamp, observation.lat, observation.lon);
      const effectiveSpeed = observation.speed ?? (imm.speedMs > 2 ? imm.speedMs : 45);
      const effectiveHeading = observation.heading ?? (imm.headingDeg || 0);

      const rawThreat = (observation.meta as any)?.threatEvidence ?? observation.threatEvidence;
      const obsThreatEvidence: string[] = typeof rawThreat === "string"
        ? [rawThreat]
        : Array.isArray(rawThreat)
        ? rawThreat
        : [];
      const rawEv = (observation.meta as any)?.evidence ?? (observation as any).evidence;
      if (typeof rawEv === "string" && (
        rawEv.startsWith("acoustic_") ||
        rawEv.startsWith("optical_") ||
        rawEv.startsWith("radar_") ||
        rawEv.startsWith("threat_")
      )) {
        obsThreatEvidence.push(rawEv);
      }

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
        evidence: typeof observation.meta?.evidence === "string" ? [observation.meta.evidence] : undefined,
        threatEvidence: obsThreatEvidence,
        isSynthetic,
        positionConfidence: observation.confidence,
        isCorroborated: false
      });

      // Maintain explicit spatial uncertainty from observation (e.g. 12km for acoustic, 250m for optical, 30m for radar)
      const obsUncertainty = typeof observation.meta?.measurement_accuracy === "number"
        ? (observation.meta.measurement_accuracy as number)
        : (observation.uncertaintyRadius || imm.uncertaintyRadiusMeters);
      const effectiveUncertainty = Math.max(obsUncertainty, imm.uncertaintyRadiusMeters);

      // Positional sources with transponder or radar start CONFIRMED; isolated indirect acoustic/optical start TENTATIVE
      const isHighConfidence = (observation.confidence >= 0.88 && sourceFamily !== "acoustic") || observation.source === "sdr" || isSynthetic;
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
        positionConfidence: classification.positionConfidence,
        classConfidence: classification.classConfidence,
        classEvidence: classification.classEvidence,
        threatEvidence: classification.threatEvidence,
        sources: new Set([observation.source]),
        altitude: classification.estimatedAltitudeM,
        covLat: imm.covLat,
        covLon: imm.covLon,
        uncertaintyRadius: Math.round(effectiveUncertainty),
        threatLevel: (observation.meta?.threatLevel as ThreatLevel) || undefined,
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

      this.applySanityCheckToTrack(state);

      this.tracks.set(targetId, {
        state,
        filter,
        lastMeasurementTime: now,
        firstSeen: now,
        hitsCount: 1,
        lastImmResult: imm,
        lastMahalanobisDistance: correlation.mahalanobisDistance
      });
      productionObservability.recordObservationFused(1);
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

    // EW / Impossible Jump Detection (gated to non-synthetic movement jumps > 3000m):
    const isImpossibleJump = !isSynthetic && (
      (derivedSpeed > 1100 && distanceMeters > 3000) ||
      (distanceMeters > 40_000 && elapsedSeconds < 30 && previous.speed < 300)
    );
    const effectiveLat = isImpossibleJump ? previous.lat : imm.lat;
    const effectiveLon = isImpossibleJump ? previous.lon : imm.lon;
    const updatedSpeed = isImpossibleJump
      ? previous.speed
      : (observation.speed ?? (derivedSpeed > 10 && derivedSpeed < 1100 ? derivedSpeed : (imm.speedMs || previous.speed)));
    const updatedHeading = isImpossibleJump ? previous.heading : (observation.heading ?? derivedHeading);

    const mergedSources = new Set([...previous.sources, observation.source]);
    const mergedFamilies = new Set([...(previous.evidenceFamilies || []), sourceFamily]);

    // Source diversity bonus strictly requires independent evidence families.
    // adsb.lol and airplanes.live both belong to "adsb" (ADS-B/MLAT) - so no false independent confirmation is granted!
    const isMultiFamily = mergedFamilies.size > 1 && !mergedFamilies.has("simulation");
    const sourceDiversityBonus = isMultiFamily ? 0.20 : 0;
    let updatedConfidence = Math.min(
      0.99,
      previous.confidence * 0.4 + observation.confidence * 0.5 + sourceDiversityBonus
    );

    if (isImpossibleJump) {
      updatedConfidence = Math.min(updatedConfidence, 0.25);
    }

    const obsUncertainty = typeof observation.meta?.measurement_accuracy === "number"
      ? (observation.meta.measurement_accuracy as number)
      : (observation.uncertaintyRadius || imm.uncertaintyRadiusMeters);

    // Multi-sensor uncertainty covariance intersection:
    // Independent sensor families cross-corroborating shrink the spatial uncertainty radius.
    let updatedUncertainty: number;
    if (isMultiFamily) {
      const prevVar = Math.max(100 ** 2, (previous.uncertaintyRadius || 1000) ** 2);
      const obsVar = Math.max(100 ** 2, obsUncertainty ** 2);
      const fusedVar = 1 / (1 / prevVar + 1 / obsVar);
      updatedUncertainty = Math.max(75, Math.sqrt(fusedVar));
    } else if (sourceFamily === "acoustic") {
      // Single uncorroborated acoustic sensor maintains wide uncertainty area
      updatedUncertainty = Math.max(previous.uncertaintyRadius || 12_000, obsUncertainty);
    } else {
      updatedUncertainty = imm.uncertaintyRadiusMeters;
    }

    const rawThreat = (observation.meta as any)?.threatEvidence ?? observation.threatEvidence;
    const obsThreatEvidence: string[] = typeof rawThreat === "string"
      ? [rawThreat]
      : Array.isArray(rawThreat)
      ? rawThreat
      : [];
    const rawEv = (observation.meta as any)?.evidence ?? (observation as any).evidence;
    if (typeof rawEv === "string" && (
      rawEv.startsWith("acoustic_") ||
      rawEv.startsWith("optical_") ||
      rawEv.startsWith("radar_") ||
      rawEv.startsWith("threat_")
    )) {
      obsThreatEvidence.push(rawEv);
    }

    const mergedThreatEvidence = Array.from(
      new Set([...(previous.threatEvidence || []), ...obsThreatEvidence])
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
      evidence: previous.evidence,
      threatEvidence: mergedThreatEvidence,
      isSynthetic: previous.isSynthetic || isSynthetic,
      positionConfidence: updatedConfidence,
      isCorroborated: isMultiFamily || previous.isSynthetic || isSynthetic
    });

    // Lifecycle promotion: independent multi-family corroboration confirms tentative tracks
    const updatedLifecycle: TrackLifecycle =
      isMultiFamily || (existing.hitsCount >= 2 && sourceFamily !== "acoustic")
        ? "CONFIRMED"
        : (sourceFamily === "acoustic" && !isMultiFamily ? "TENTATIVE" : (previous.lifecycle || "CONFIRMED"));

    // Update measured history ring buffer (keep last 5 measured points)
    const updatedHistory = previous.measuredHistory ? [...previous.measuredHistory] : [];
    updatedHistory.push([observation.lat, observation.lon, observation.timestamp]);
    if (updatedHistory.length > 5) updatedHistory.shift();

    // Update provenance chain ring buffer (keep last 8 entries)
    const updatedProvenance = previous.provenanceChain ? [provenanceEntry, ...previous.provenanceChain] : [provenanceEntry];
    if (updatedProvenance.length > 8) updatedProvenance.pop();

    existing.lastMeasurementTime = now;
    existing.state = {
      ...previous,
      type: classification.resolvedType,
      lat: effectiveLat,
      lon: effectiveLon,
      heading: Math.round(updatedHeading * 10) / 10,
      speed: Math.round(updatedSpeed * 10) / 10,
      altitude: classification.estimatedAltitudeM,
      timestamp: observation.timestamp,
      confidence: Math.round(updatedConfidence * 100) / 100,
      positionConfidence: isImpossibleJump ? 0.25 : classification.positionConfidence,
      classConfidence: isImpossibleJump ? 0.20 : classification.classConfidence,
      classEvidence: isImpossibleJump ? [...(classification.classEvidence || []), "impossible_jump_suppressed"] : classification.classEvidence,
      threatEvidence: classification.threatEvidence,
      sources: mergedSources,
      covLat: imm.covLat,
      covLon: imm.covLon,
      uncertaintyRadius: Math.round(updatedUncertainty),
      lastUpdated: now,
      model: isImpossibleJump ? "Невідома повітряна ціль (аномальний стрибок РЕБ)" : classification.resolvedModel,
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
      isDegraded: isImpossibleJump || previous.isDegraded || false,
      ewFlags: isImpossibleJump ? Array.from(new Set([...(previous.ewFlags || []), "impossible_jump_rejected"])) : previous.ewFlags,
      syntheticScenario: previous.syntheticScenario || syntheticScenario,
      provenanceChain: updatedProvenance
    };

    this.applySanityCheckToTrack(existing.state);
    productionObservability.recordObservationFused(1);

    return existing.state;
  }

  removeTrack(id: string): boolean {
    this.recentlyRemovedIds.add(id);
    return this.tracks.delete(id);
  }

  tick(now = Date.now()): void {
    this.runRegionalSanityCheck();
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

      // 2.1 Purge synthetic tracks in unalarmed regions immediately
      if (entry.state.isSynthetic && this.activeAlertOblasts.size > 0) {
        const nearest = findNearestOblast(entry.state.lat, entry.state.lon);
        const regionKey = nearest.oblast.toLowerCase().replace("область", "").replace("обл.", "").trim();
        const regionUkKey = nearest.nameUk.toLowerCase();
        const hasAlert = Array.from(this.activeAlertOblasts).some(
          (a) => a.includes(regionKey) || regionKey.includes(a) || a.includes(regionUkKey) || regionUkKey.includes(a)
        );
        if (!hasAlert) {
          this.removeTrack(id);
          continue;
        }
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
      .filter((track) => track.lifecycle !== "TENTATIVE" || track.confidence >= 0.20)
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
  getDeltaPacket(includeSynthetic = true, cycle = 0): {
    seq: number;
    tracks: CompactTrackPacket[];
    removedIds: string[];
    binaryBuffer: Uint8Array;
  } {
    const seq = this.getNextSequence();
    const allTracks = this.toPackets(includeSynthetic);
    const removedIds = Array.from(this.recentlyRemovedIds);
    this.recentlyRemovedIds.clear();

    for (const rid of removedIds) {
      this.lastPublishedState.delete(rid);
    }

    // Adaptive update rate: urgent/fast tracks sent every tick (1s); distant/stationary tracks sent periodically
    const deltaTracks =
      cycle === 0
        ? allTracks
        : allTracks.filter((t) => {
            const type = t[1];
            const speed = t[5];
            const threat = t[9];
            const isUrgent =
              type === "uav" ||
              type === "munition" ||
              type === "bomb" ||
              type === "fpv" ||
              speed > 40 ||
              threat === "high" ||
              threat === "critical";

            if (isUrgent) return true;
            if (speed > 10 || type === "aircraft" || type === "helicopter") {
              return cycle % 2 === 0;
            }
            return cycle % 4 === 0;
          });

    const binaryBuffer = encodeBinaryDelta(
      deltaTracks,
      removedIds,
      seq,
      Date.now(),
      this.lastPublishedState
    );

    for (const t of deltaTracks) {
      this.lastPublishedState.set(t[0], t);
    }

    return { seq, tracks: deltaTracks, removedIds, binaryBuffer };
  }

  /**
   * Generates complete binary snapshot for initial connection / reconnect
   */
  getBinarySnapshot(includeSynthetic = true): Uint8Array {
    const tracks = this.toPackets(includeSynthetic);
    return encodeBinarySnapshot(tracks, this.seqNumber, Date.now());
  }

  /**
   * Diagnostic lookup for a single track
   */
  getDiagnosticReport(id?: string): TrackDiagnosticReport | null {
    const targetId = id || Array.from(this.tracks.keys())[0];
    return targetId ? this.getTrackDiagnostic(targetId) : null;
  }

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
        positionConfidence: t.positionConfidence,
        classConfidence: t.classConfidence,
        classEvidence: t.classEvidence ?? [],
        threatEvidence: t.threatEvidence ?? [],
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
