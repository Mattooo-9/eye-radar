import { existsSync, mkdirSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  EPHEMERAL_TTL_MS,
  MessageDeletionService,
  messageDeletionService,
  SIX_HOURS_MS,
  THIRTY_MINUTES_MS,
  sendBotMessage
} from "../server/bot/messageDeletionService.js";
import { LifecycleCleanupService, RETENTION_POLICY } from "../server/core/lifecyclePolicy.js";

describe("Unified Information Lifecycle & Self-Cleaning Policy", () => {
  it("enforces centralized retention constants across bot, map, and database", () => {
    expect(SIX_HOURS_MS).toBe(6 * 60 * 60 * 1000);
    expect(THIRTY_MINUTES_MS).toBe(30 * 60 * 1000);
    expect(EPHEMERAL_TTL_MS).toBe(15 * 60 * 1000);
    expect(RETENTION_POLICY.DB_TEMP_RECORDS_RETENTION_MS).toBe(24 * 60 * 60 * 1000);
    expect(RETENTION_POLICY.DB_DIAGNOSTIC_LOGS_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(RETENTION_POLICY.DB_OFFICIAL_ALERT_HISTORY_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("holds active civil warnings until official all-clear, then deletes them 30 minutes after all-clear", async () => {
    const testPath = resolve(process.cwd(), "data", `test_lc_warn_${Date.now()}.json`);
    const service = new MessageDeletionService(testPath);
    const chatId = 505001;
    const warningMsgId = 9001;
    const t0 = 1_795_520_000_000;

    await service.scheduleDeletion(
      chatId,
      warningMsgId,
      {
        category: "active_warning",
        dedupKey: "oblast_alert:київська",
        holdUntilClear: true,
        ttlMs: 1000 // even if nominal ttl is short, holdUntilClear keeps it active during the alarm
      },
      t0
    );

    const deletedIds: number[] = [];
    const mockTg = {
      deleteMessage: async (_cId: number, mId: number) => {
        deletedIds.push(mId);
      }
    };

    // 1. Two hours into an ongoing air-raid alert: active warning MUST NOT be deleted prematurely
    await service.processPendingDeletions(mockTg, t0 + 2 * 60 * 60 * 1000);
    expect(deletedIds).toHaveLength(0);
    expect(service.getQueueSize()).toBe(1);

    // 2. Official all-clear arrives at t0 + 2h -> schedules deletion in 30 minutes
    const tClear = t0 + 2 * 60 * 60 * 1000;
    const released = await service.releaseActiveWarningsOnAllClear(chatId, THIRTY_MINUTES_MS, tClear);
    expect(released).toBe(1);

    // 3. 15 minutes after all-clear: still visible (within 30-min post-clear window)
    await service.processPendingDeletions(mockTg, tClear + 15 * 60 * 1000);
    expect(deletedIds).toHaveLength(0);

    // 4. 31 minutes after all-clear: automatically deleted!
    const res = await service.processPendingDeletions(mockTg, tClear + 31 * 60 * 1000);
    expect(res.deleted).toBe(1);
    expect(deletedIds).toEqual([warningMsgId]);
    expect(service.getQueueSize()).toBe(0);

    if (existsSync(testPath)) unlinkSync(testPath);
  });

  it("preserves permanent main_menu messages across periodic sweeps and chat purges", async () => {
    const testPath = resolve(process.cwd(), "data", `test_lc_menu_${Date.now()}.json`);
    const service = new MessageDeletionService(testPath);
    const chatId = 505002;
    const menuMsgId = 100;
    const ephemeralMsgId = 101;
    const t0 = 1_795_520_000_000;

    await service.scheduleDeletion(
      chatId,
      menuMsgId,
      { category: "main_menu", dedupKey: "main_menu" },
      t0
    );
    await service.scheduleDeletion(
      chatId,
      ephemeralMsgId,
      { category: "ephemeral", ttlMs: EPHEMERAL_TTL_MS },
      t0
    );

    const deletedIds: number[] = [];
    const mockTg = {
      deleteMessage: async (_cId: number, mId: number) => {
        deletedIds.push(mId);
      }
    };

    // After 20 minutes: ephemeral reply is deleted, permanent main menu stays
    await service.processPendingDeletions(mockTg, t0 + 20 * 60 * 1000);
    expect(deletedIds).toEqual([ephemeralMsgId]);
    expect(await service.findPendingByDedupKey(chatId, "main_menu")).toBe(menuMsgId);

    // User runs /clean: main_menu is still preserved
    await service.purgeChatMessages(chatId, mockTg, false);
    expect(await service.findPendingByDedupKey(chatId, "main_menu")).toBe(menuMsgId);

    if (existsSync(testPath)) unlinkSync(testPath);
  });

  it("updates repeated notifications in-place via editMessageText when dedupKey matches", async () => {
    const origFetch = globalThis.fetch;
    const origToken = process.env.BOT_TOKEN;
    process.env.BOT_TOKEN = "123456:TEST_TOKEN_FOR_UNIT_TEST";

    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      calls.push({ url: String(url), body });
      if (String(url).includes("/sendMessage")) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 777 } }), { status: 200 });
      }
      if (String(url).includes("/editMessageText")) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 777 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as any;

    const uniqueDedupKey = `track:osint-uav-${Date.now()}`;
    try {
      const first = await sendBotMessage(90901, "БпЛА ~25 км", {
        category: "active_warning",
        dedupKey: uniqueDedupKey
      });
      expect(first.ok).toBe(true);
      expect(first.messageId).toBe(777);
      expect(first.updatedInPlace).toBe(false);

      const second = await sendBotMessage(90901, "БпЛА ~12 км (оновлено)", {
        category: "active_warning",
        dedupKey: uniqueDedupKey
      });
      expect(second.ok).toBe(true);
      expect(second.messageId).toBe(777);
      expect(second.updatedInPlace).toBe(true);
      expect(calls.some((c) => c.url.includes("/editMessageText"))).toBe(true);
    } finally {
      await messageDeletionService.markCompleted(90901, 777);
      globalThis.fetch = origFetch;
      if (origToken === undefined) delete process.env.BOT_TOKEN;
      else process.env.BOT_TOKEN = origToken;
    }
  });

  it("handles Telegram 429 retry_after and 48h 'message can't be deleted' without infinite loops", async () => {
    const testPath = resolve(process.cwd(), "data", `test_lc_429_${Date.now()}.json`);
    const service = new MessageDeletionService(testPath);
    const t0 = 1_795_520_000_000;

    await service.scheduleDeletion(6001, 201, 1000, t0);
    await service.scheduleDeletion(6001, 202, 1000, t0);

    const mockTg = {
      deleteMessage: async (_cId: number, mId: number) => {
        if (mId === 201) {
          const err: any = new Error("Too Many Requests: retry after 45");
          err.response = { parameters: { retry_after: 45 } };
          throw err;
        }
        throw new Error("Bad Request: message can't be deleted");
      }
    };

    const res = await service.processPendingDeletions(mockTg, t0 + 5_000);
    // 202 is completed terminally (48h Telegram limit), 201 is rescheduled +45s
    expect(res.deleted).toBe(1);
    expect(res.errors).toBe(1);
    const job201 = service.getJob(6001, 201);
    expect(job201?.deleteAt).toBe(t0 + 5_000 + 45_000);

    if (existsSync(testPath)) unlinkSync(testPath);
  });

  it("records anonymized official alert history and cleans orphaned .tmp files", async () => {
    const cleanup = new LifecycleCleanupService();
    const now = Date.now();

    await cleanup.recordOfficialAlertTransition({
      oblast: "Київська область",
      eventType: "alert_start",
      source: "ubilling.net.ua/aerialalerts",
      recordedAt: now - 10_000
    });
    await cleanup.recordOfficialAlertTransition({
      oblast: "Київська область",
      eventType: "alert_clear",
      source: "ubilling.net.ua/aerialalerts",
      recordedAt: now
    });

    const history = await cleanup.getOfficialAlertHistory(10);
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0].eventType).toBe("alert_clear");
    expect(history[1].eventType).toBe("alert_start");

    // Create an old orphaned .tmp file in data/ and verify sweep removes it
    const dataDir = resolve(process.cwd(), "data");
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const staleTmp = resolve(dataDir, `orphan_${now}.tmp`);
    writeFileSync(staleTmp, "stale", "utf8");
    const oldTime = new Date(now - RETENTION_POLICY.LOCAL_TMP_FILE_MAX_AGE_MS - 60_000);
    utimesSync(staleTmp, oldTime, oldTime);

    const stats = await cleanup.runCleanupSweep(now);
    expect(stats.cleanedTempFiles).toBeGreaterThanOrEqual(1);
    expect(existsSync(staleTmp)).toBe(false);
  });
});
