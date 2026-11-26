import { describe, expect, it } from "vitest";
import { parseOsintBulletin, parseOsintImpact, parseOsintText, isStandDownMessage } from "../server/ingest/osintParser.js";
import { isInsideUkraineGeo } from "../server/sources/ukraineGeo.js";
import { classifyAerialObject } from "../server/core/classificationEngine.js";

describe("OSINT Parser", () => {
  it("parses explicit numeric coordinates with keyword", () => {
    const raw = "Зафіксовано uav 50.45 30.52 курс 180 швидкість 50";
    const observations = parseOsintText(raw, 1700000000000);

    expect(observations.length).toBeGreaterThan(0);
    const obs = observations[0];
    expect(obs.type).toBe("uav");
    expect(obs.lat).toBeCloseTo(50.45, 2);
    expect(obs.lon).toBeCloseTo(30.52, 2);
    expect(obs.heading).toBe(180);
    expect(obs.speed).toBe(50);
  });

  it("parses natural language Ukrainian monitoring message with city and direction", () => {
    const raw = "⚠️ Шахеди з півдня повз Кременчук курсом на Полтаву!";
    const observations = parseOsintText(raw, 1700000000000);

    expect(observations.length).toBeGreaterThan(0);
    const obs = observations[0];
    expect(obs.type).toBe("uav");
    // Should identify Kremenchuk or Poltava
    expect(obs.lat).toBeGreaterThan(48.0);
    expect(obs.lat).toBeLessThan(51.0);
  });

  it("correctly identifies КАБ / УМПК glide bomb threat from text", () => {
    const raw = "⚠️ Пуски КАБ тактичною авіацією на Харків!";
    const observations = parseOsintText(raw, 1700000000000);

    expect(observations.length).toBeGreaterThan(0);
    const obs = observations[0];
    expect(obs.type).toBe("bomb");
    expect(obs.speed).toBeGreaterThan(200);
    expect(obs.meta?.model).toContain("КАБ");
  });

  it("correctly identifies FPV strike drone from text", () => {
    const raw = "Ударний FPV-дрон помічено біля Куп'янська!";
    const observations = parseOsintText(raw, 1700000000000);

    expect(observations.length).toBeGreaterThan(0);
    const obs = observations[0];
    expect(obs.type).toBe("fpv");
    expect(obs.speed).toBeLessThan(50);
    expect(obs.meta?.model).toContain("FPV");
  });

  it("parses multi-line air-defense monitoring bulletin and Russian place names without fabrication", () => {
    const tPub = 1_795_518_000_000;
    const tNow = tPub + 120_000;
    const bulletin = [
      "Миколаївщина",
      "1 реактивний БпЛА на Казанку",
      "1 реактивний БпЛА на Березанку",
      "",
      "Запорізька область",
      "4 БпЛА на Запоріжжя"
    ].join("\n");

    const parsed = parseOsintBulletin(bulletin, tPub, tNow);
    expect(parsed.length).toBe(3);
    expect(parsed[0].observation.meta?.cityName).toBe("Казанка");
    expect(parsed[0].observation.lat).toBeCloseTo(47.84, 1);
    expect(parsed[1].observation.meta?.cityName).toBe("Березанка");
    expect(parsed[2].observation.meta?.cityName).toBe("Запоріжжя");
    expect(parsed[2].observation.meta?.model).toContain("4х");
  });

  it("derives incoming approach vectors accurately and respects corridor destination without overshooting", () => {
    const tPub = 1_795_518_000_000;
    const tNow = tPub + 600_000; // 10 min later
    const parsedWest = parseOsintBulletin("🏍 Реактивний БпЛА на Миколаїв із заходу.", tPub, tNow);
    expect(parsedWest.length).toBe(1);
    expect(parsedWest[0].observation.heading).toBe(90); // Coming FROM West -> moving East (90 deg)
    expect(parsedWest[0].observation.lon).toBeLessThanOrEqual(31.995); // Has NOT overshot Mykolaiv eastwards

    const parsedEast = parseOsintBulletin("3 ударных на Шевченково с востока", tPub, tPub + 60_000);
    expect(parsedEast.length).toBe(1);
    expect(parsedEast[0].observation.heading).toBe(270); // Coming FROM East -> moving West (270 deg)
    expect(parsedEast[0].observation.meta?.cityName).toBe("Шевченкове");
    expect(parsedEast[0].observation.meta?.model).toContain("3х");
  });

  it("rejects fundraisers, deepstrike RF news, and stand-down notices", () => {
    const now = Date.now();
    expect(isStandDownMessage("⚪️ Відбій загрози балістики.")).toBe(true);
    expect(parseOsintBulletin("⚪️ Відбій загрози балістики.", now, now)).toHaveLength(0);
    expect(parseOsintBulletin("Колега просить долучитись до дружнього збору на FPV дрони для ГУР", now, now)).toHaveLength(0);
    expect(parseOsintBulletin("Самара, скучили? СБС уразили Куйбишевський НПЗ у Самарі, рф", now, now)).toHaveLength(0);
  });

  it("decodes Cyrillic/Latin homoglyphs used by Ukrainian radar channels", () => {
    const now = 1_795_518_000_000;
    const obfuscated = "‼️🚀 Пуcки KAБів, c. Таврійськe тa ближні села в укpиття!";
    const parsed = parseOsintBulletin(obfuscated, now, now + 15_000, "Запорізька область");
    expect(parsed).toHaveLength(1);
    expect(parsed[0].observation.type).toBe("bomb");
    expect(parsed[0].observation.meta?.cityName).toBe("Таврійське");
    expect(parsed[0].observation.meta?.model).toContain("КАБ");
  });

  it("enforces exact Ukraine border polygon (excludes Romanian/European border corridors)", () => {
    // Inside Ukraine
    expect(isInsideUkraineGeo(50.45, 30.52)).toBe(true); // Kyiv
    expect(isInsideUkraineGeo(46.48, 30.72)).toBe(true); // Odesa
    expect(isInsideUkraineGeo(49.99, 36.23)).toBe(true); // Kharkiv
    expect(isInsideUkraineGeo(47.84, 35.14)).toBe(true); // Zaporizhzhia
    // Outside Ukraine (Romania / Hungary / Poland airliners previously leaking through bbox)
    expect(isInsideUkraineGeo(47.23, 23.32)).toBe(false); // Baia Mare, Romania (WZZ4848)
    expect(isInsideUkraineGeo(46.53, 22.03)).toBe(false); // Oradea, Romania (AAR522)
    expect(isInsideUkraineGeo(44.62, 24.23)).toBe(false); // Craiova, Romania (WMT3394)
    expect(isInsideUkraineGeo(45.50, 22.10)).toBe(false); // Caransebes, Romania (THY4DE)
  });

  it("bounds and deduplicates evidence arrays across repeated classification cycles", () => {
    let evidence: string[] = ["official_air_force_bulletin", "air_defense_osint"];
    let threatEvidence: string[] = ["official_air_force_bulletin", "air_defense_osint"];
    for (let i = 0; i < 30; i++) {
      const res = classifyAerialObject({
        claimedType: "uav",
        speedMs: 52,
        altitudeM: 180,
        headingDeg: 270,
        sources: ["public.osint"],
        evidence,
        threatEvidence,
        modelHint: "Shahed-136 / Герань-2"
      });
      evidence = res.evidence;
      threatEvidence = res.threatEvidence;
    }
    expect(evidence.length).toBeLessThanOrEqual(10);
    expect(threatEvidence.length).toBeLessThanOrEqual(10);
  });

  it("extracts real OSINT air-defense interceptions and explosions with expanded Ukraine geo coverage", () => {
    const now = 1_795_518_000_000;
    const intercept = parseOsintImpact("🛡️ Робота ППО у Затоці, збито ворожий БпЛА!", now);
    expect(intercept).not.toBeNull();
    expect(intercept?.type).toBe("intercept");
    expect(intercept?.region).toBe("Затока");

    const explosion = parseOsintImpact("💥 Вибух в Охтирці після прильоту КАБ!", now);
    expect(explosion).not.toBeNull();
    expect(explosion?.type).toBe("impact");
    expect(explosion?.region).toBe("Охтирка");

    const geran5 = parseOsintBulletin("⚠️ Ракета Герань-5 на Деснянську ТЕЦ!", now, now + 10_000);
    expect(geran5).toHaveLength(1);
    expect(geran5[0].observation.meta?.cityName).toBe("Деснянський р-н");
  });
});
