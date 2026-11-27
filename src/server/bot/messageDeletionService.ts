// src/server/bot/messageDeletionService.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { getPool } from "../db/pool.js";
import { RETENTION_POLICY } from "../core/lifecyclePolicy.js";
import { createLogger } from "../observability/logger.js";

const log = createLogger("message-lifecycle");

export type BotMessageCategory = "standard" | "active_warning" | "ephemeral" | "main_menu";

export interface DeletionJob {
  chatId: number;
  messageId: number;
  sentAt?: number;
  deleteAt: number;
  createdAt: number;
  deletedAt?: number;
  retryCount: number;
  status: "pending" | "completed" | "failed";
  category?: BotMessageCategory;
  dedupKey?: string;
  holdUntilClear?: boolean;
  lastError?: string;
}

export interface ScheduleDeletionOptions {
  ttlMs?: number;
  category?: BotMessageCategory;
  dedupKey?: string;
  holdUntilClear?: boolean;
}

export const SIX_HOURS_MS = RETENTION_POLICY.BOT_STANDARD_NOTIFICATION_TTL_MS;
export const THIRTY_MINUTES_MS = RETENTION_POLICY.BOT_POST_ALL_CLEAR_TTL_MS;
export const EPHEMERAL_TTL_MS = RETENTION_POLICY.BOT_EPHEMERAL_REPLY_TTL_MS;
export const TEST_TTL_MS = RETENTION_POLICY.BOT_TEST_TTL_MS;

const getBotTokenFromEnv = (): string =>
  (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();

const isNonRetryableTelegramError = (msg: string): boolean => {
  const lower = msg.toLowerCase();
  return (
    lower.includes("message to delete not found") ||
    lower.includes("message can't be deleted") ||
    lower.includes("message identifier is not specified") ||
    lower.includes("chat not found") ||
    lower.includes("bot was blocked") ||
    lower.includes("user is deactivated")
  );
};

export class MessageDeletionService {
  private pool: pg.Pool | null = null;
  private isPostgresAvailable = false;
  private initPromise: Promise<void> | null = null;
  private localQueue = new Map<string, DeletionJob>();
  private readonly storagePath: string;
  private isProcessing = false;

  constructor(customStoragePath?: string) {
    const isVercel = Boolean(process.env.VERCEL);
    this.storagePath =
      customStoragePath ||
      (isVercel
        ? resolve("/tmp", "message_deletion_queue.json")
        : resolve(process.cwd(), "data", "message_deletion_queue.json"));
    this.initLocalStore();
    this.initPromise = this.initPostgres();
  }

  private initLocalStore(): void {
    try {
      const dir = dirname(this.storagePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      if (existsSync(this.storagePath)) {
        const raw = readFileSync(this.storagePath, "utf8");
        const list = JSON.parse(raw) as DeletionJob[];
        for (const job of list) {
          const key = `${job.chatId}:${job.messageId}`;
          this.localQueue.set(key, job);
        }
      }
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "Could not read local queue file");
    }
  }

  private persistLocalStore(): void {
    try {
      const dir = dirname(this.storagePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = JSON.stringify([...this.localQueue.values()], null, 2);
      const tempPath = `${this.storagePath}.tmp`;
      writeFileSync(tempPath, data, "utf8");
      renameSync(tempPath, this.storagePath);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "Failed to persist local queue");
    }
  }

  private async ensurePostgres(): Promise<boolean> {
    if (process.env.NODE_ENV === "test" && !process.env.TEST_POSTGRES) {
      return false;
    }
    if (this.isPostgresAvailable && this.pool) return true;
    if (!this.initPromise) {
      this.initPromise = this.initPostgres();
    }
    await this.initPromise;
    return this.isPostgresAvailable;
  }

  private async initPostgres(): Promise<void> {
    if (process.env.NODE_ENV === "test" && !process.env.TEST_POSTGRES) {
      this.isPostgresAvailable = false;
      return;
    }
    try {
      const sharedPool = getPool();
      if (!sharedPool) {
        this.isPostgresAvailable = false;
        return;
      }
      this.pool = sharedPool;

      const client = await this.pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS bot_message_deletion_queue (
            chat_id BIGINT NOT NULL,
            message_id BIGINT NOT NULL,
            sent_at BIGINT,
            delete_at BIGINT NOT NULL,
            created_at BIGINT NOT NULL,
            deleted_at BIGINT,
            retry_count INT DEFAULT 0,
            status VARCHAR(20) DEFAULT 'pending',
            category VARCHAR(32) DEFAULT 'standard',
            dedup_key VARCHAR(128),
            hold_until_clear BOOLEAN DEFAULT false,
            last_error TEXT,
            PRIMARY KEY (chat_id, message_id)
          );
          ALTER TABLE bot_message_deletion_queue ADD COLUMN IF NOT EXISTS sent_at BIGINT;
          ALTER TABLE bot_message_deletion_queue ADD COLUMN IF NOT EXISTS deleted_at BIGINT;
          ALTER TABLE bot_message_deletion_queue ADD COLUMN IF NOT EXISTS category VARCHAR(32) DEFAULT 'standard';
          ALTER TABLE bot_message_deletion_queue ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(128);
          ALTER TABLE bot_message_deletion_queue ADD COLUMN IF NOT EXISTS hold_until_clear BOOLEAN DEFAULT false;
          CREATE INDEX IF NOT EXISTS idx_bmdq_delete_at ON bot_message_deletion_queue (delete_at) WHERE status = 'pending';
          CREATE INDEX IF NOT EXISTS idx_bmdq_status ON bot_message_deletion_queue (status);
          CREATE INDEX IF NOT EXISTS idx_bmdq_chat_dedup ON bot_message_deletion_queue (chat_id, dedup_key) WHERE status = 'pending';
        `);
        this.isPostgresAvailable = true;
      } finally {
        client.release();
      }
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "PostgreSQL queue unavailable, using local fallback");
      this.isPostgresAvailable = false;
    }
  }

  async scheduleDeletion(
    chatId: number,
    messageId: number,
    ttlOrOptions: number | ScheduleDeletionOptions = SIX_HOURS_MS,
    now = Date.now()
  ): Promise<void> {
    const opts: ScheduleDeletionOptions =
      typeof ttlOrOptions === "number" ? { ttlMs: ttlOrOptions } : ttlOrOptions;
    const category: BotMessageCategory = opts.category ?? "standard";
    const holdUntilClear = opts.holdUntilClear ?? category === "active_warning";
    const defaultTtl =
      category === "active_warning"
        ? RETENTION_POLICY.BOT_ACTIVE_WARNING_SAFETY_TTL_MS
        : category === "ephemeral"
        ? EPHEMERAL_TTL_MS
        : SIX_HOURS_MS;
    const ttlMs = opts.ttlMs ?? defaultTtl;
    // Permanent main_menu messages use far-future sentinel unless explicitly superseded
    const deleteAt = category === "main_menu" ? now + 365 * 24 * 60 * 60 * 1000 : now + ttlMs;
    const key = `${chatId}:${messageId}`;

    const job: DeletionJob = {
      chatId,
      messageId,
      sentAt: now,
      deleteAt,
      createdAt: now,
      retryCount: 0,
      status: "pending",
      category,
      dedupKey: opts.dedupKey,
      holdUntilClear
    };

    this.localQueue.set(key, job);
    this.persistLocalStore();

    await this.ensurePostgres();
    if (this.isPostgresAvailable && this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO bot_message_deletion_queue
            (chat_id, message_id, sent_at, delete_at, created_at, retry_count, status, category, dedup_key, hold_until_clear)
           VALUES ($1, $2, $3, $4, $5, 0, 'pending', $6, $7, $8)
           ON CONFLICT (chat_id, message_id) DO UPDATE SET
             sent_at = $3,
             delete_at = $4,
             status = 'pending',
             category = $6,
             dedup_key = $7,
             hold_until_clear = $8`,
          [chatId, messageId, now, deleteAt, now, category, opts.dedupKey ?? null, holdUntilClear]
        );
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "Failed to insert deletion job into Postgres");
      }
    }
  }

  /**
   * Finds an active pending message in `chatId` matching `dedupKey` so repeated
   * notifications update the existing message in-place rather than spamming new ones.
   */
  async findPendingByDedupKey(chatId: number, dedupKey: string): Promise<number | null> {
    for (const job of this.localQueue.values()) {
      if (job.chatId === chatId && job.status === "pending" && job.dedupKey === dedupKey) {
        return job.messageId;
      }
    }

    await this.ensurePostgres();
    if (this.isPostgresAvailable && this.pool) {
      try {
        const res = await this.pool.query(
          `SELECT message_id as "messageId"
           FROM bot_message_deletion_queue
           WHERE chat_id = $1 AND dedup_key = $2 AND status = 'pending'
           ORDER BY created_at DESC
           LIMIT 1`,
          [chatId, dedupKey]
        );
        if (res.rows.length > 0) {
          return Number(res.rows[0].messageId);
        }
      } catch {}
    }
    return null;
  }

  /**
   * Called on official air-raid ALL-CLEAR ("відбій") for `chatId`:
   * Releases all active civil warning messages (`category === "active_warning"` or `holdUntilClear === true`)
   * and schedules their deletion in exactly 30 minutes (`BOT_POST_ALL_CLEAR_TTL_MS`).
   */
  async releaseActiveWarningsOnAllClear(
    chatId: number,
    postClearTtlMs = THIRTY_MINUTES_MS,
    now = Date.now()
  ): Promise<number> {
    const newDeleteAt = now + postClearTtlMs;
    let released = 0;

    for (const job of this.localQueue.values()) {
      if (
        job.chatId === chatId &&
        job.status === "pending" &&
        (job.category === "active_warning" || job.holdUntilClear)
      ) {
        job.holdUntilClear = false;
        job.deleteAt = newDeleteAt;
        released++;
      }
    }
    if (released > 0) {
      this.persistLocalStore();
    }

    await this.ensurePostgres();
    if (this.isPostgresAvailable && this.pool) {
      try {
        const res = await this.pool.query(
          `UPDATE bot_message_deletion_queue
           SET hold_until_clear = false,
               delete_at = $2
           WHERE chat_id = $1
             AND status = 'pending'
             AND (category = 'active_warning' OR hold_until_clear = true)`,
          [chatId, newDeleteAt]
        );
        released = Math.max(released, res.rowCount ?? 0);
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "Failed to release active warnings on all-clear");
      }
    }

    return released;
  }

  async replyAndSchedule(
    ctx: any,
    text: string,
    extra?: any,
    ttlOrOptions: number | ScheduleDeletionOptions = SIX_HOURS_MS
  ): Promise<any> {
    const sent = await ctx.reply(text, extra);
    if (sent?.message_id && ctx.chat?.id) {
      await this.scheduleDeletion(ctx.chat.id, sent.message_id, ttlOrOptions);
    }
    return sent;
  }

  async sendMessageAndSchedule(
    telegramOrBot: any,
    chatId: number,
    text: string,
    extra?: any,
    ttlOrOptions: number | ScheduleDeletionOptions = SIX_HOURS_MS
  ): Promise<any> {
    const tg = telegramOrBot.telegram ?? telegramOrBot;
    const sent = await tg.sendMessage(chatId, text, extra);
    if (sent?.message_id) {
      await this.scheduleDeletion(chatId, sent.message_id, ttlOrOptions);
    }
    return sent;
  }

  async processPendingDeletions(
    botOrTelegram?: any,
    now = Date.now()
  ): Promise<{ deleted: number; errors: number }> {
    if (this.isProcessing) return { deleted: 0, errors: 0 };
    this.isProcessing = true;

    let deletedCount = 0;
    let errorCount = 0;
    const safetyCutoff = now - RETENTION_POLICY.BOT_ACTIVE_WARNING_SAFETY_TTL_MS;

    try {
      const jobsToProcess: DeletionJob[] = [];

      await this.ensurePostgres();
      if (this.isPostgresAvailable && this.pool) {
        try {
          const res = await this.pool.query(
            `SELECT chat_id as "chatId", message_id as "messageId", delete_at as "deleteAt",
                    created_at as "createdAt", retry_count as "retryCount",
                    category, dedup_key as "dedupKey", hold_until_clear as "holdUntilClear"
             FROM bot_message_deletion_queue
             WHERE status = 'pending'
               AND COALESCE(category, 'standard') <> 'main_menu'
               AND (
                 (COALESCE(hold_until_clear, false) = false AND delete_at <= $1)
                 OR created_at <= $2
               )
             ORDER BY delete_at ASC
             LIMIT 50
             FOR UPDATE SKIP LOCKED`,
            [now, safetyCutoff]
          );
          for (const row of res.rows) {
            jobsToProcess.push({
              chatId: Number(row.chatId),
              messageId: Number(row.messageId),
              deleteAt: Number(row.deleteAt),
              createdAt: Number(row.createdAt || 0),
              retryCount: Number(row.retryCount || 0),
              status: "pending",
              category: (row.category as BotMessageCategory) || "standard",
              dedupKey: row.dedupKey || undefined,
              holdUntilClear: Boolean(row.holdUntilClear)
            });
          }
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, "Postgres query failed during deletion sweep");
        }
      }

      if (jobsToProcess.length === 0) {
        for (const job of this.localQueue.values()) {
          if (job.status !== "pending") continue;
          if (job.category === "main_menu") continue;
          const isHeld = Boolean(job.holdUntilClear) && job.createdAt > safetyCutoff;
          if (!isHeld && job.deleteAt <= now) {
            jobsToProcess.push(job);
            if (jobsToProcess.length >= 50) break;
          }
        }
      }

      for (const job of jobsToProcess) {
        const key = `${job.chatId}:${job.messageId}`;
        let success = false;
        let retryAfterMs: number | null = null;

        try {
          if (botOrTelegram) {
            const tg = botOrTelegram.telegram ?? botOrTelegram;
            await tg.deleteMessage(job.chatId, job.messageId);
            success = true;
          } else {
            const token = getBotTokenFromEnv();
            if (token) {
              const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: job.chatId,
                  message_id: job.messageId
                }),
                signal: AbortSignal.timeout(4000)
              });
              if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                  description?: string;
                  parameters?: { retry_after?: number };
                };
                const desc = data.description || `HTTP ${res.status}`;
                if (res.status === 429 && data.parameters?.retry_after) {
                  retryAfterMs = Number(data.parameters.retry_after) * 1000;
                  throw new Error(desc);
                }
                if (isNonRetryableTelegramError(desc)) {
                  success = true;
                } else {
                  throw new Error(desc);
                }
              } else {
                success = true;
              }
            }
          }
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          const tgRetryAfter = err?.response?.parameters?.retry_after;
          if (typeof tgRetryAfter === "number" && tgRetryAfter > 0) {
            retryAfterMs = tgRetryAfter * 1000;
          }
          if (isNonRetryableTelegramError(errMsg)) {
            success = true;
          } else {
            errorCount++;
            job.retryCount = (job.retryCount || 0) + 1;
            job.lastError = errMsg;

            if (job.retryCount >= RETENTION_POLICY.BOT_MAX_RETRY_COUNT) {
              job.status = "failed";
            } else {
              job.deleteAt = now + (retryAfterMs ?? 1000 * Math.pow(2, job.retryCount));
            }
          }
        }

        if (success) {
          deletedCount++;
          this.localQueue.delete(key);

          if (this.isPostgresAvailable && this.pool) {
            try {
              await this.pool.query(
                `UPDATE bot_message_deletion_queue
                 SET status = 'completed', deleted_at = $3, last_error = NULL
                 WHERE chat_id = $1 AND message_id = $2`,
                [job.chatId, job.messageId, now]
              );
            } catch {}
          }
        } else if (this.isPostgresAvailable && this.pool) {
          try {
            await this.pool.query(
              `UPDATE bot_message_deletion_queue
               SET retry_count = $1, delete_at = $2, status = $3, last_error = $4
               WHERE chat_id = $5 AND message_id = $6`,
              [job.retryCount, job.deleteAt, job.status, job.lastError, job.chatId, job.messageId]
            );
          } catch {}
        }

        await new Promise((resolveDelay) => setTimeout(resolveDelay, 35));
      }

      // Prune completed/failed items from local memory map
      for (const [k, job] of this.localQueue.entries()) {
        if (job.status !== "pending") {
          this.localQueue.delete(k);
        }
      }
      this.persistLocalStore();
    } finally {
      this.isProcessing = false;
    }

    return { deleted: deletedCount, errors: errorCount };
  }

  async markCompleted(chatId: number, messageId: number): Promise<void> {
    const key = `${chatId}:${messageId}`;
    this.localQueue.delete(key);
    this.persistLocalStore();

    await this.ensurePostgres();
    if (this.isPostgresAvailable && this.pool) {
      try {
        await this.pool.query(
          `UPDATE bot_message_deletion_queue
           SET status = 'completed', deleted_at = $3, last_error = NULL
           WHERE chat_id = $1 AND message_id = $2`,
          [chatId, messageId, Date.now()]
        );
      } catch {}
    }
  }

  async purgeChatMessages(chatId: number, botOrTelegram?: any, includeMainMenu = false): Promise<number> {
    const tg = botOrTelegram?.telegram ?? botOrTelegram;
    let purged = 0;
    const messageIds: number[] = [];

    await this.ensurePostgres();
    if (this.isPostgresAvailable && this.pool) {
      try {
        const res = await this.pool.query(
          `SELECT message_id as "messageId", category
           FROM bot_message_deletion_queue
           WHERE chat_id = $1 AND status = 'pending'`,
          [chatId]
        );
        for (const row of res.rows) {
          if (!includeMainMenu && row.category === "main_menu") continue;
          messageIds.push(Number(row.messageId));
        }
      } catch {}
    }

    for (const job of this.localQueue.values()) {
      if (job.chatId === chatId && job.status === "pending") {
        if (!includeMainMenu && job.category === "main_menu") continue;
        if (!messageIds.includes(job.messageId)) {
          messageIds.push(job.messageId);
        }
      }
    }

    const token = getBotTokenFromEnv();
    for (const msgId of messageIds) {
      try {
        if (tg) {
          await tg.deleteMessage(chatId, msgId);
        } else if (token) {
          await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, message_id: msgId }),
            signal: AbortSignal.timeout(4000)
          });
        }
        await this.markCompleted(chatId, msgId);
        purged++;
      } catch {
        await this.markCompleted(chatId, msgId);
      }
    }

    return purged;
  }

  getQueueSize(): number {
    let pending = 0;
    for (const job of this.localQueue.values()) {
      if (job.status === "pending") pending++;
    }
    return pending;
  }

  getJob(chatId: number, messageId: number): DeletionJob | undefined {
    return this.localQueue.get(`${chatId}:${messageId}`);
  }
}

export const messageDeletionService = new MessageDeletionService();

export interface SendBotMessageOptions {
  parse_mode?: "Markdown" | "HTML";
  reply_markup?: any;
  ttlMs?: number;
  category?: BotMessageCategory;
  dedupKey?: string;
  holdUntilClear?: boolean;
}

/**
 * Universal Telegram bot message dispatcher with centralized lifecycle policy:
 * - If `dedupKey` matches an active pending message in `chatId`, edits the existing message
 *   in-place (`editMessageText`) instead of creating duplicate notification spam.
 * - Schedules lifecycle retention according to `category` (`standard` 6h, `active_warning` held
 *   until official all-clear + 30m post-clear, `ephemeral` 15m, `main_menu` permanent).
 */
export async function sendBotMessage(
  chatId: number | string,
  text: string,
  options?: SendBotMessageOptions
): Promise<{ ok: boolean; messageId?: number; updatedInPlace?: boolean; error?: string }> {
  const token = getBotTokenFromEnv();
  if (!token) {
    return { ok: false, error: "BOT_TOKEN not configured" };
  }

  const numericChatId = Number(chatId);
  const category: BotMessageCategory = options?.category ?? "standard";
  const dedupKey = options?.dedupKey;
  const holdUntilClear = options?.holdUntilClear ?? category === "active_warning";

  try {
    // 1. In-place deduplicated update if an active message with the same dedupKey exists
    if (dedupKey && Number.isFinite(numericChatId)) {
      const existingMsgId = await messageDeletionService.findPendingByDedupKey(numericChatId, dedupKey);
      if (existingMsgId) {
        const editPayload: Record<string, any> = {
          chat_id: chatId,
          message_id: existingMsgId,
          text,
          parse_mode: options?.parse_mode ?? "Markdown"
        };
        if (options?.reply_markup) {
          editPayload.reply_markup = options.reply_markup;
        }
        const editRes = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editPayload),
          signal: AbortSignal.timeout(6000)
        });
        const editData = (await editRes.json().catch(() => ({}))) as {
          ok?: boolean;
          description?: string;
        };

        if (editRes.ok && editData.ok) {
          await messageDeletionService.scheduleDeletion(numericChatId, existingMsgId, {
            ttlMs: options?.ttlMs,
            category,
            dedupKey,
            holdUntilClear
          });
          return { ok: true, messageId: existingMsgId, updatedInPlace: true };
        }
        if (editData.description?.toLowerCase().includes("message is not modified")) {
          return { ok: true, messageId: existingMsgId, updatedInPlace: true };
        }
        // If message was deleted by user, mark old record completed and send a new message below
        await messageDeletionService.markCompleted(numericChatId, existingMsgId);
      }
    }

    // 2. Send new message
    const payload: Record<string, any> = {
      chat_id: chatId,
      text,
      parse_mode: options?.parse_mode ?? "Markdown"
    };
    if (options?.reply_markup) {
      payload.reply_markup = options.reply_markup;
    }

    let res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000)
    });

    let data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { message_id: number };
      description?: string;
    };

    if (!res.ok && data.description?.toLowerCase().includes("can't parse entities")) {
      delete payload.parse_mode;
      res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000)
      });
      data = (await res.json().catch(() => ({}))) as any;
    }

    if (!res.ok || !data.ok || !data.result?.message_id) {
      const errText = data.description || `HTTP ${res.status}`;
      log.warn({ chatId, error: errText }, "Telegram sendMessage API error");
      return { ok: false, error: errText };
    }

    const messageId = data.result.message_id;
    await messageDeletionService.scheduleDeletion(numericChatId, messageId, {
      ttlMs: options?.ttlMs,
      category,
      dedupKey,
      holdUntilClear
    });
    return { ok: true, messageId, updatedInPlace: false };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    log.warn({ chatId, error: errMsg }, "Telegram sendBotMessage exception");
    return { ok: false, error: errMsg };
  }
}
