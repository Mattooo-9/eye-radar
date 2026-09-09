import { describe, expect, it } from "vitest";
import { parseOsintText } from "../server/ingest/osintParser.js";

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

  it("correctly identifies missile threat from text", () => {
    const raw = "Швидкісна ціль (імовірно крилата ракета) в напрямку Одеса!";
    const observations = parseOsintText(raw, 1700000000000);

    expect(observations.length).toBeGreaterThan(0);
    const obs = observations[0];
    expect(obs.type).toBe("munition");
    expect(obs.speed).toBeGreaterThan(150); // High speed for cruise missile
  });
});
