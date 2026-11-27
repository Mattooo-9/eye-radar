import { describe, expect, it, vi } from "vitest";
import {
  AlertSubscribeSchema,
  CitizenReportSchema,
  LocationSaveSchema,
  OsintFeedQuerySchema,
  OsintIngestSchema,
  ReplayQuerySchema,
  SdrIngestSchema,
  parseJsonWithSchema,
  parseWithSchema
} from "../server/validation/schemas.js";
import { TechnicalFailureMonitor } from "../server/observability/failureMonitor.js";
import { createLogger, logger } from "../server/observability/logger.js";

describe("Stage 3 — Unified Zod Validation, Pino Logging & Failure Monitoring", () => {
  describe("Zod runtime schemas", () => {
    it("validates valid citizen report and sanitizes HTML/newline characters", () => {
      const res = parseJsonWithSchema(
        JSON.stringify({
          type: "uav_sound",
          lat: 50.45,
          lon: 30.52,
          direction: "NW",
          comment: "  <script>Чую\nБпЛА</script> біля парку  "
        }),
        CitizenReportSchema
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.direction).toBe("NW");
        expect(res.data.comment).not.toContain("<");
        expect(res.data.comment).not.toContain(">");
        expect(res.data.comment).not.toContain("\n");
      }
    });

    it("rejects out-of-Ukraine coordinates, invalid direction, and malformed JSON", () => {
      const badCoords = parseWithSchema({ lat: 10, lon: 10 }, CitizenReportSchema);
      expect(badCoords.ok).toBe(false);

      const badDir = parseWithSchema({ lat: 50.4, lon: 30.5, direction: "UP" }, CitizenReportSchema);
      expect(badDir.ok).toBe(false);

      const badJson = parseJsonWithSchema("{broken", CitizenReportSchema);
      expect(badJson.ok).toBe(false);
    });

    it("validates location save, alert subscription, OSINT/SDR ingest, and query params", () => {
      expect(parseWithSchema({ userId: "123456", lat: 49.99, lon: 36.23, radiusKm: 35 }, LocationSaveSchema).ok).toBe(true);
      expect(parseWithSchema({ userId: "not-a-num", lat: 49.99, lon: 36.23 }, LocationSaveSchema).ok).toBe(false);
      expect(parseWithSchema({ userId: 777, radiusKm: 25 }, AlertSubscribeSchema).ok).toBe(true);
      expect(parseWithSchema({ userId: 777, radiusKm: 999 }, AlertSubscribeSchema).ok).toBe(false);

      expect(parseWithSchema({ text: "БпЛА курсом на Полтаву" }, OsintIngestSchema).ok).toBe(true);
      expect(parseWithSchema({}, OsintIngestSchema).ok).toBe(false);

      expect(
        parseWithSchema({ observations: [{ id: "sdr-1", lat: 50.1, lon: 30.2, speed: 55 }] }, SdrIngestSchema).ok
      ).toBe(true);
      expect(parseWithSchema({ observations: [] }, SdrIngestSchema).ok).toBe(false);

      const rq = parseWithSchema({ offsetSec: "120" }, ReplayQuerySchema);
      expect(rq.ok && rq.data.offsetSec === 120).toBe(true);
      expect(parseWithSchema({ offsetSec: "99999" }, ReplayQuerySchema).ok).toBe(false);

      const fq = parseWithSchema({ limit: "15" }, OsintFeedQuerySchema);
      expect(fq.ok && fq.data.limit === 15).toBe(true);
    });
  });

  describe("Pino structured logger", () => {
    it("creates child module loggers cleanly", () => {
      const child = createLogger("test-module");
      expect(typeof logger.info).toBe("function");
      expect(typeof child.error).toBe("function");
      expect(child.bindings().module).toBe("test-module");
    });
  });

  describe("TechnicalFailureMonitor", () => {
    it("opens and resolves incidents with deduplicated cooldown dispatching", async () => {
      const sent: Array<{ action: string; key: string }> = [];
      const dispatcher = {
        send: vi.fn(async ({ action, incident }: any) => {
          sent.push({ action, key: incident.key });
        })
      };
      const monitor = new TechnicalFailureMonitor(dispatcher);
      const t0 = 1_795_520_000_000;

      // Healthy baseline
      const okSnap = monitor.evaluate({
        now: t0,
        uptimeSeconds: 120,
        memoryMb: 80,
        dbOk: true,
        dbLatencyMs: 90,
        alertStatus: "fresh",
        alertConsecutiveFailures: 0,
        osintTotalChannels: 14,
        osintRespondingChannels: 14
      });
      expect(okSnap.status).toBe("OK");
      expect(okSnap.activeIncidentsCount).toBe(0);

      // DB outage + official alert outage + memory pressure -> CRITICAL
      const critSnap = monitor.evaluate({
        now: t0 + 30_000,
        uptimeSeconds: 150,
        memoryMb: 190,
        dbOk: false,
        dbError: "connection refused",
        alertStatus: "stale",
        alertConsecutiveFailures: 4,
        alertError: "HTTP 503",
        osintTotalChannels: 14,
        osintRespondingChannels: 5
      });
      expect(critSnap.status).toBe("CRITICAL");
      expect(critSnap.activeIncidentsCount).toBe(4);
      expect(sent.filter((s) => s.action === "OPEN").length).toBe(4);

      // Re-evaluating same outage 30s later must NOT re-dispatch duplicate notifications
      monitor.evaluate({
        now: t0 + 60_000,
        uptimeSeconds: 180,
        memoryMb: 195,
        dbOk: false,
        dbError: "connection refused",
        alertStatus: "stale",
        alertConsecutiveFailures: 5,
        osintTotalChannels: 14,
        osintRespondingChannels: 5
      });
      expect(sent.filter((s) => s.action === "OPEN").length).toBe(4);

      // Recovery -> RESOLVED notifications fired & status returns to OK
      const recovered = monitor.evaluate({
        now: t0 + 90_000,
        uptimeSeconds: 210,
        memoryMb: 82,
        dbOk: true,
        dbLatencyMs: 85,
        alertStatus: "fresh",
        alertConsecutiveFailures: 0,
        osintTotalChannels: 14,
        osintRespondingChannels: 14
      });
      expect(recovered.status).toBe("OK");
      expect(recovered.activeIncidentsCount).toBe(0);
      expect(sent.filter((s) => s.action === "RESOLVED").length).toBe(4);

      // Runtime error counter increments cleanly
      monitor.recordRuntimeError("unit-test", new Error("boom"));
      expect(monitor.getSnapshot().runtimeErrorsCount).toBe(1);
    });
  });
});
