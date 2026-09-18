import { describe, it, expect } from "vitest";
import { computeLaunchIntelligence, getTargetSpecification } from "../client/lib/targetSpecs";

describe("Military Launch Intelligence & Origin Facts (Uncensored / OSINT / PPO)", () => {
  it("provides authentic launch base and military unit for Shahed-136 in Southern sector", () => {
    const intel = computeLaunchIntelligence("uav", "Shahed-136", 46.5, 33.0, 310, "shahed-south-1");
    expect(intel.launchOrigin).toContain("Приморсько-Ахтарськ");
    expect(intel.launchAirbase).toContain("726-й учбовий центр ППО");
    expect(intel.launchUnit).toContain("пускові розрахунки БПЛА");
    expect(intel.launchTrajectoryVector).toContain("310°");
    expect(intel.launchOriginDetailed).toBeDefined();
  });

  it("provides authentic launch base for Shahed-136 in Crimean sector", () => {
    const intel = computeLaunchIntelligence("uav", "Shahed-136", 45.1, 35.5, 290, "shahed-crimea-1");
    expect(intel.launchOrigin).toContain("Чауда");
    expect(intel.launchAirbase).toContain("Чауда");
    expect(intel.launchUnit).toContain("пускові розрахунки БПЛА");
  });

  it("provides authentic launch base for Shahed-136 in Northern sector (Kursk / Belgorod)", () => {
    const intel = computeLaunchIntelligence("uav", "Shahed-136", 51.5, 36.0, 220, "shahed-north-1");
    expect(intel.launchOrigin).toContain("Курськ");
    expect(intel.launchAirbase).toContain("Халіно");
    expect(intel.launchUnit).toContain("20-ї гвардійської армії");
  });

  it("provides authentic launch base for Shahed-136 in Bryansk / Sesha sector", () => {
    const intel = computeLaunchIntelligence("uav", "Shahed-136", 52.0, 32.5, 200, "shahed-north-2");
    expect(intel.launchOrigin).toContain("Сеща");
    expect(intel.launchAirbase).toContain("Сеща");
    expect(intel.launchUnit).toContain("Shahed");
  });

  it("provides authentic carrier and airfield for KAB / UMPK glide bombs", () => {
    const intel = computeLaunchIntelligence("bomb", "КАБ-500 (УМПК)", 49.8, 36.5, 260, "kab-kharkiv-1");
    expect(intel.launchOrigin).toContain("Рубіж скиду тактичної авіації");
    expect(intel.launchOriginDetailed).toContain("Су-34");
    expect(intel.launchAirbase).toContain("Балтимор");
    expect(intel.launchUnit).toContain("105-та змішана авіаційна дивізія");
    expect(intel.launchTrajectoryVector).toContain("УМПК");
  });

  it("provides authentic Long-Range Aviation data for Kh-101 cruise missiles", () => {
    const intel = computeLaunchIntelligence("munition", "Х-101", 49.0, 32.0, 270, "kh101-1");
    expect(intel.launchOrigin).toContain("Каспійським морем");
    expect(intel.launchAirbase).toContain("Оленья");
    expect(intel.launchAirbase).toContain("Енгельс-2");
    expect(intel.launchUnit).toContain("22-га гвардійська важка бомбардувальна авіаційна дивізія");
    expect(intel.launchOriginDetailed).toContain("Ту-95МС");
  });

  it("provides authentic Black Sea Fleet naval base for Kalibr cruise missiles", () => {
    const intel = computeLaunchIntelligence("munition", "Калібр 3М14", 45.0, 31.5, 340, "kalibr-1");
    expect(intel.launchOrigin).toContain("Новоросійськ");
    expect(intel.launchAirbase).toContain("Новоросійська військово-морська база");
    expect(intel.launchUnit).toContain("41-ша бригада ракетних кораблів");
  });

  it("provides authentic missile brigade for Iskander-M ballistic missiles", () => {
    const intel = computeLaunchIntelligence("munition", "Іскандер-М", 50.5, 35.0, 240, "iskander-1");
    expect(intel.launchOrigin).toContain("Іскандер-М");
    expect(intel.launchUnit).toContain("448-ма");
    expect(intel.launchTrajectoryVector).toContain("балістичний підйом");
  });

  it("provides authentic frontline unit for FPV tactical drones", () => {
    const intel = computeLaunchIntelligence("fpv", "FPV-дрон", 47.5, 36.0, 330, "fpv-1");
    expect(intel.launchOrigin).toContain("лінії бойового зіткнення");
    expect(intel.launchAirbase).toContain("Польові пункти управління");
    expect(intel.launchUnit).toContain("операторів ударних безпілотників");
  });

  it("provides authentic civil aviation data for ADS-B flights in European airspace", () => {
    const intel = computeLaunchIntelligence("aircraft", "Boeing 737-800", 50.1, 23.5, 120, "adsb-lot123");
    expect(intel.launchOrigin).toContain("Польщі");
    expect(intel.launchAirbase).toContain("Варшава");
    expect(intel.launchUnit).toContain("Eurocontrol");
  });

  it("integrates launch intelligence seamlessly into getTargetSpecification", () => {
    const spec = getTargetSpecification(
      "uav",
      "shahed-test-1",
      185,
      150,
      "Shahed-136 (Герань-2)",
      "SH136",
      46.8,
      32.5,
      305
    );

    expect(spec.launchOriginDetailed).toBeDefined();
    expect(spec.launchAirbase).toBeDefined();
    expect(spec.launchUnit).toBeDefined();
    expect(spec.launchTrajectoryVector).toBeDefined();
    expect(spec.detectionSensors).toBeDefined();
    expect(spec.warhead).toBeDefined();
    expect(spec.typicalSpeed).toContain("160");
  });
});
