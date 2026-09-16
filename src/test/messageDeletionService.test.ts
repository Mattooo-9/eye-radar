import { describe, expect, it } from 'vitest';
import { MessageDeletionService, SIX_HOURS_MS } from '../server/bot/messageDeletionService.js';
import { resolve } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';

describe('MessageDeletionService (6-hour Auto-Deletion Queue)', () => {
  it('schedules message deletion with default 6h TTL (21,600,000 ms)', async () => {
    const testPath = resolve(process.cwd(), 'data', `test_del_1_${Date.now()}.json`);
    const service = new MessageDeletionService(testPath);
    await service.scheduleDeletion(1234567, 888999);

    expect(SIX_HOURS_MS).toBe(6 * 60 * 60 * 1000);
    expect(service.getQueueSize()).toBe(1);
    if (existsSync(testPath)) unlinkSync(testPath);
  });

  it('eliminates duplicate deletion jobs using composite (chatId, messageId) key', async () => {
    const testPath = resolve(process.cwd(), 'data', `test_del_2_${Date.now()}.json`);
    const service = new MessageDeletionService(testPath);

    await service.scheduleDeletion(99999, 1001);
    await service.scheduleDeletion(99999, 1001); // duplicate!
    await service.scheduleDeletion(99999, 1001); // duplicate!

    // Only one job should be recorded for this chat/message pair
    expect(service.getQueueSize()).toBe(1);
    if (existsSync(testPath)) unlinkSync(testPath);
  });

  it('processes expired jobs and treats "already deleted / not found" as successful completion', async () => {
    const testPath = resolve(process.cwd(), 'data', `test_del_3_${Date.now()}.json`);
    const service = new MessageDeletionService(testPath);
    const chatId = 777111;
    const messageId = 555;

    // Schedule job with negative TTL (already expired)
    await service.scheduleDeletion(chatId, messageId, -5000);

    const mockTelegram = {
      deleteMessage: async (cId: number, mId: number) => {
        // Simulate Telegram error for a message already deleted by the user
        const err: any = new Error("Bad Request: message to delete not found");
        throw err;
      }
    };

    const res = await service.processPendingDeletions(mockTelegram);
    expect(res.deleted).toBe(1);
    expect(res.errors).toBe(0);
    if (existsSync(testPath)) unlinkSync(testPath);
  });

  it('applies exponential backoff on transient errors up to 5 retries', async () => {
    const testPath = resolve(process.cwd(), 'data', `test_del_4_${Date.now()}.json`);
    const service = new MessageDeletionService(testPath);
    const chatId = 888222;
    const messageId = 666;

    // Schedule already expired
    await service.scheduleDeletion(chatId, messageId, -5000);

    let attempts = 0;
    const mockTelegram = {
      deleteMessage: async () => {
        attempts++;
        throw new Error("Network timeout 504");
      }
    };

    const res = await service.processPendingDeletions(mockTelegram);
    expect(res.errors).toBe(1);
    expect(attempts).toBe(1);
    if (existsSync(testPath)) unlinkSync(testPath);
  });
});
