// src/server/sources/adsbClassifier.ts
// Single Source of Truth for ADS-B / MLAT transponder classification across all feeds.
import { getDistanceToUkraineBorderKm } from "../domain/geo.js";
import { isInsideUkraineGeo } from "./ukraineGeo.js";

const MILITARY_KEYWORDS = [
  "C-17", "GLOBEMASTER", "C-5", "GALAXY", "C-27", "SPARTAN", "C-130", "HERCULES",
  "A400", "ATLAS", "KC-", "K35R", "STRATOTANKER", "PEGASUS", "P-8", "POSEIDON",
  "E-3", "E-7", "AWACS", "SENTRY", "RQ-", "MQ-", "GLOBAL HAWK", "REAPER",
  "C295", "C-295", "PERSUADER", "SKYTRUCK", "M-28", "M28", "C-37", "C37",
  "C-21", "C21", "C-26", "C26", "METRO", "F-16", "F-15", "F-35", "FIGHTER",
  "TYPHOON", "RAFALE", "GRIPEN", "MIRAGE", "SU-", "MIG-", "TU-", "AN-", "IL-",
  "FORTE", "LAGR", "HOMER", "JAKE", "VIPER", "RED", "NATO", "RCH", "REACH",
  "ROF", "BAF", "GAF", "IAM", "RFR", "ASCOT", "PLF", "HAF", "TUAF", "USAF",
  "CNV", "DAF", "SQF", "CEF", "HRZ", "FAF", "RAFR", "PAROL", "BRIO", "DRAGN",
  "SVF", "MMF", "NCHO", "HOIST", "HVK", "MIL_", "MILITARY", "NAVY", "ARMY",
  "TANKER", "BOMBER"
];

const HELICOPTER_KEYWORDS = [
  "HELICOPTER", "ROTORCRAFT", "BELL ", "SIKORSKY", "EUROCOPTER",
  "EC1", "EC2", "H125", "H135", "H145", "MI-8", "MI-2", "MI-24", "KA-52", "R44", "R66"
];

export const CIVIL_AIRLINE_PREFIXES = [
  "RYR", "WZZ", "WMT", "WUK", "LOT", "DLH", "KLM", "AFR", "BAW", "THY", "AUA",
  "SXS", "PGT", "EZY", "EZS", "SAS", "FIN", "BTI", "ENT", "TOM", "FDB", "AAR",
  "ETH", "ROT", "CAI", "ISR", "PIA", "FDX", "UPS", "BOX", "CGF", "MNB", "VLG",
  "UTN", "LBT", "NMA", "GJT", "ASL", "EXS", "CCA", "SIA", "RYS", "NSZ", "UAE",
  "QTR", "ETD", "ELY", "AEE", "TVS", "CLX", "GEC", "BCS", "DHK", "NJE", "VJT",
  "MSC"
];

const CIVIL_AIRFRAME_MARKERS = [
  "B73", "B74", "B75", "B76", "B77", "B78",
  "A31", "A32", "A33", "A35", "A38", "A20N", "A21N", "B38M", "B39M", "CIVIL"
];

export function isMilitaryAircraft(callsign?: string, desc?: string, model?: string): boolean {
  const text = `${callsign ?? ""} ${desc ?? ""} ${model ?? ""}`.toUpperCase();
  return MILITARY_KEYWORDS.some((kw) => text.includes(kw));
}

export function isHelicopterAirframe(desc?: string, model?: string): boolean {
  const text = `${desc ?? ""} ${model ?? ""}`.toUpperCase();
  return HELICOPTER_KEYWORDS.some((kw) => text.includes(kw));
}

export function isCivilAirliner(callsign?: string, desc?: string, model?: string): boolean {
  if (isMilitaryAircraft(callsign, desc, model)) return false;
  const upperCall = (callsign ?? "").trim().toUpperCase();
  if (CIVIL_AIRLINE_PREFIXES.some((prefix) => upperCall.startsWith(prefix))) {
    return true;
  }
  const text = `${upperCall} ${desc ?? ""} ${model ?? ""}`.toUpperCase();
  return CIVIL_AIRFRAME_MARKERS.some((m) => text.includes(m));
}

/**
 * Operational intake gate: excludes all European civilian commercial airliners.
 * Admits only verified military aircraft within 350 km of Ukraine's border
 * OR non-civilian contacts physically inside Ukraine's national border polygon.
 */
export function shouldIngestAdsbContact(
  lat: number,
  lon: number,
  callsign?: string,
  desc?: string,
  model?: string
): { allowed: boolean; isMil: boolean; isInsideUkraine: boolean } {
  const isMil = isMilitaryAircraft(callsign, desc, model);
  const isCivil = isCivilAirliner(callsign, desc, model);
  if (isCivil) {
    return { allowed: false, isMil: false, isInsideUkraine: false };
  }
  const isInsideUkraine = isInsideUkraineGeo(lat, lon);
  const inMilTheater = isMil && getDistanceToUkraineBorderKm(lat, lon) <= 350;
  return {
    allowed: isInsideUkraine || inMilTheater,
    isMil,
    isInsideUkraine
  };
}
