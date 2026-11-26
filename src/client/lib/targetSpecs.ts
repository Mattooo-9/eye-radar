// src/client/lib/targetSpecs.ts
// Truthful, zero-fabrication display metadata for aerial observations & OSINT text reports.
// Unknown parameters remain explicitly unknown; no synthetic airbases, military units, or template TTX are invented.

export type ClientDataCategory = "unverified_report" | "osint_message" | "sensor_observation";

export interface TargetDisplayMeta {
  modelName: string;
  categoryLabel: string;
  dataCategory: ClientDataCategory;
  dataCategoryBadge: string;
  threatLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  color: string;
  safetyNote: string;
}

export interface AltitudeSummary {
  altitudeM: number;
  flightLevel: string;
  bandLabel: string;
  badgeColor: string;
}

export function classifyClientDataCategory(id: string, callsign?: string): ClientDataCategory {
  if (id.startsWith("citizen-")) {
    return "unverified_report";
  }
  if (id.startsWith("osint-") || (callsign && callsign.startsWith("@"))) {
    return "osint_message";
  }
  return "sensor_observation";
}

/**
 * Formats coordinates truthfully to match source spatial precision (no false ±11 m precision for ±6.5 km text alerts).
 */
export function formatTruthfulCoords(lat: number, lon: number, category: ClientDataCategory): string {
  if (category === "sensor_observation") {
    return `${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`;
  }
  return `~${lat.toFixed(2)}°N, ~${lon.toFixed(2)}°E`;
}

/**
 * Formats physically measured altitude ONLY. Returns null when altitude is unknown.
 */
export function getAltitudeAnalysis(altM?: number | null): AltitudeSummary | null {
  if (altM === undefined || altM === null || !Number.isFinite(altM) || altM <= 0) {
    return null;
  }
  const fl = Math.round(altM * 0.0328084);
  const flightLevel = `FL ${String(fl).padStart(3, "0")}`;

  if (altM < 300) {
    return { altitudeM: Math.round(altM), flightLevel, bandLabel: "Мала висота", badgeColor: "#ef4444" };
  }
  if (altM < 3000) {
    return { altitudeM: Math.round(altM), flightLevel, bandLabel: "Середня висота", badgeColor: "#f59e0b" };
  }
  if (altM < 8000) {
    return { altitudeM: Math.round(altM), flightLevel, bandLabel: "Високий ешелон", badgeColor: "#38bdf8" };
  }
  return { altitudeM: Math.round(altM), flightLevel, bandLabel: "Верхній ешелон", badgeColor: "#818cf8" };
}

/**
 * Formats compass vector ONLY when heading is known (measured or explicitly stated in OSINT).
 */
export function getHeadingVectorDescription(
  heading?: number | null,
  hasVector = true
): { forwardSummary: string; compassShort: string } {
  if (!hasVector || heading === undefined || heading === null || !Number.isFinite(heading)) {
    return {
      forwardSummary: "Напрямок руху: невідомо (повідомлення без зазначення курсу)",
      compassShort: "Невідомо"
    };
  }
  const norm = ((Math.round(heading) % 360) + 360) % 360;
  const dirs = [
    { short: "N", uk: "північ" },
    { short: "NE", uk: "північний схід" },
    { short: "E", uk: "схід" },
    { short: "SE", uk: "південний схід" },
    { short: "S", uk: "південь" },
    { short: "SW", uk: "південний захід" },
    { short: "W", uk: "захід" },
    { short: "NW", uk: "північний захід" }
  ];
  const d = dirs[Math.round(norm / 45) % 8];
  return {
    forwardSummary: `Курс ${norm}° (${d.short}, ${d.uk})`,
    compassShort: `${norm}° ${d.short}`
  };
}

/**
 * Returns factual, source-grounded display metadata without fabricated military specs.
 */
export function getTargetDisplayMeta(
  type: string,
  id: string,
  packetModel?: string,
  packetCallsign?: string
): TargetDisplayMeta {
  const dataCategory = classifyClientDataCategory(id, packetCallsign);
  const dataCategoryBadge =
    dataCategory === "unverified_report"
      ? "НЕПЕРЕВІРЕНЕ ПОВІДОМЛЕННЯ (ОЧЕВИДЕЦЬ)"
      : dataCategory === "osint_message"
      ? "ТЕКСТОВЕ ПОВІДОМЛЕННЯ (OSINT)"
      : "ФАКТИЧНЕ СПОСТЕРЕЖЕННЯ (ADS-B)";

  const cleanModel = (packetModel || "").trim();

  if (type === "munition") {
    return {
      modelName: cleanModel || "Ракетна ціль (тип не уточнено)",
      categoryLabel: "Ракетна загроза",
      dataCategory,
      dataCategoryBadge,
      threatLevel: "CRITICAL",
      color: "#f97316",
      safetyNote: "Підвищена небезпека. Перебувайте в укритті до офіційного відбою тривоги."
    };
  }

  if (type === "bomb") {
    return {
      modelName: cleanModel || "Керована авіабомба / КАБ",
      categoryLabel: "Авіабомбова загроза",
      dataCategory,
      dataCategoryBadge,
      threatLevel: "CRITICAL",
      color: "#f59e0b",
      safetyNote: "Негайно перейдіть в укриття або захищене приміщення."
    };
  }

  if (type === "uav") {
    return {
      modelName: cleanModel || "БпЛА (тип не уточнено)",
      categoryLabel: "Безпілотний літальний апарат",
      dataCategory,
      dataCategoryBadge,
      threatLevel: "HIGH",
      color: "#ef4444",
      safetyNote: "Слідкуйте за офіційними сповіщеннями та тримайтесь подалі від вікон."
    };
  }

  if (type === "fpv") {
    return {
      modelName: cleanModel || "FPV-дрон",
      categoryLabel: "Тактичний FPV-дрон",
      dataCategory,
      dataCategoryBadge,
      threatLevel: "HIGH",
      color: "#a855f7",
      safetyNote: "Загроза ближньої зони. Уникайте відкритих ділянок та перебувайте в укритті."
    };
  }

  if (type === "aircraft") {
    return {
      modelName: cleanModel || "Повітряне судно (модель не уточнено)",
      categoryLabel: dataCategory === "sensor_observation" ? "Авіація (транспондер ADS-B)" : "Авіація (повідомлення)",
      dataCategory,
      dataCategoryBadge,
      threatLevel: "LOW",
      color: "#38bdf8",
      safetyNote: "Повітряне судно зафіксовано за відкритим транспондером ADS-B."
    };
  }

  if (type === "helicopter") {
    return {
      modelName: cleanModel || "Гелікоптер",
      categoryLabel: "Гвинтокрил",
      dataCategory,
      dataCategoryBadge,
      threatLevel: "LOW",
      color: "#10b981",
      safetyNote: "Гвинтокрил зафіксовано за відкритими даними спостереження."
    };
  }

  return {
    modelName: cleanModel || "Невідома повітряна ціль",
    categoryLabel: "Некласифікований об'єкт",
    dataCategory,
    dataCategoryBadge,
    threatLevel: "MEDIUM",
    color: "#94a3b8",
    safetyNote: "Дані про тип об'єкта не підтверджені незалежними джерелами."
  };
}
