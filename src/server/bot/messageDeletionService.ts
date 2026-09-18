// src/server/bot/messageDeletionService.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { getPool } from "../db/pool.js";

const { Pool } = pg;

export interface DeletionJob {
  chatId: number;
  messageId: number;
  sentAt?: number;
  deleteAt: number; // Unix timestamp ms (sentAt + 6h)
  createdAt: number;
  retryCount: number;
  status: "pending" | "completed" | "failed";
  lastError?: string;
}

export const SIX_HOURS_MS = 6 * 60 * 60 * 1000; // Exactly 6 hours (21,600,000 ms)
export const TEST_TTL_MS = 60 * 1000; // 60 seconds test TTL

export const NEON_DEFAULT_URL =
  "postgresql://neondb_owner:npg_tN3dmj2bezwV@ep-rough-cloud-av1jwroi-pooler.c-11.us-east-1.aws.neon.tech/neondb?sslmode=require";
export const BOT_TOKEN_DEFAULT = "8703801920:AAE-U4S494ziVL5hhLJXKd8Sz_jfNihb_KQ";

export class MessageDeletionService {
  private pool: pg.Pool | null = null;
  private isPostgresAvailable = false;
  private initPromise: Promise<void> | null = null;
  private localQueue = new Map<string, DeletionJob>();
  private readonly storagePath: string;
  private isProcessing = false;

  constructor(customStoragePath?: string) {
    const isVercel = Boolean(process.env.VERCEL);
    this.storagePath = customStoragePath || (isVercel
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
      console.warn("MessageDeletionService: could not read local queue file:", err);
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
      console.error("MessageDeletionService: failed to persist local queue:", err);
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
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      NEON_DEFAULT_URL;

    try {
      const sharedPool = getPool();
      this.pool = sharedPool || new Pool({
        connectionString,
        ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
        max: 5,
        connectionTimeoutMillis: 5000
      });

      const client = await this.pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS bot_message_deletion_queue (
            chat_id BIGINT NOT NULL,
            message_id BIGINT NOT NULL,
            sent_at BIGINT,
            delete_at BIGINT NOT NULL,
            created_at BIGINT NOT NULL,
            retry_count INT DEFAULT 0,
            status VARCHAR(20) DEFAULT 'pending',
            last_error TEXT,
            PRIMARY KEY (chat_id, message_id)
          );
          ALTER TABLE bot_message_deletion_queue ADD COLUMN IF NOT EXISTS sent_at BIGINT;
          UPDATE bot_message_deletion_queue SET sent_at = created_at WHERE sent_at IS NULL;
          CREATE INDEX IF NOT EXISTS idx_bmdq_delete_at ON bot_message_deletion_queue (delete_at) WHERE status = 'pending';
          CREATE INDEX IF NOT EXISTS idx_bmdq_status ON bot_message_deletion_queue (status);
        `);
        this.isPostgresAvailable = true;
        console.log("🐘 MessageDeletionService connected to PostgreSQL / Neon queue");
      } finally {
        client.release();
      }
    } catch (err) {
      console.warn("MessageDeletionService: PostgreSQL connection failed, falling back to persistent local queue:", err);
      this.isPostgresAvailable = false;
    }
  }

  async scheduleDeletion(
    chatId: number,
    messageId: number,
    ttlMs: number = SIX_HOURS_MS
  ): Promise<void> {
    const now = Date.now();
    const deleteAt = now + ttlMs;
    const key = `${chatId}:${messageId}`;

    const job: DeletionJob = {
      chatId,
      messageId,
      sentAt: now,
      deleteAt,
      createdAt: now,
      retryCount: 0,
      status: "pending"
    };

    this.localQueue.set(key, job);
    this.persistLocalStore();

    await this.ensurePostgres();
    if (this.isPostgresAvailable && this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO bot_message_deletion_queue (chat_id, message_id, sent_at, delete_at, created_at, retry_count, status)
           VALUES ($1, $2, $3, $4, $5, 0, 'pending')
           ON CONFLICT (chat_id, message_id) DO UPDATE SET sent_at = $3, delete_at = $4, status = 'pending'`,
          [chatId, messageId, now, deleteAt, now]
        );
        console.log(`🐘 [messageDeletionService] Enqueued message ${messageId} in chat ${chatId} (delete_at = ${deleteAt}, ttl = ${Math.round(ttlMs / 1000)}s)`);
      } catch (err) {
        console.warn("Failed to insert deletion job into Postgres:", err);
      }
    }
  }

  async replyAndSchedule(ctx: any, text: string, extra?: any, ttlMs: number = SIX_HOURS_MS): Promise<any> {
    try {
      const sent = await ctx.reply(text, extra);
      if (sent?.message_id && ctx.chat?.id) {
        await this.scheduleDeletion(ctx.chat.id, sent.message_id, ttlMs);
      }
      return sent;
    } catch (err) {
      console.error("Failed to send bot reply:", err);
      throw err;
    }
  }

  async sendMessageAndSchedule(
    telegramOrBot: any,
    chatId: number,
    text: string,
    extra?: any,
    ttlMs: number = SIX_HOURS_MS
  ): Promise<any> {
    try {
      const tg = telegramOrBot.telegram ?? telegramOrBot;
      const sent = await tg.sendMessage(chatId, text, extra);
      if (sent?.message_id) {
        await this.scheduleDeletion(chatId, sent.message_id, ttlMs);
      }
      return sent;
    } catch (err) {
      console.error("Failed to send bot message:", err);
      throw err;
    }
  }

  async processPendingDeletions(
    botOrTelegram?: any
  ): Promise<{ deleted: number; errors: number }> {
    if (this.isProcessing) return { deleted: 0, errors: 0 };
    this.isProcessing = true;

    let deletedCount = 0;
    let errorCount = 0;
    const now = Date.now();

    try {
      const jobsToProcess: DeletionJob[] = [];

      await this.ensurePostgres();
      if (this.isPostgresAvailable && this.pool) {
        try {
          const res = await this.pool.query(
            `SELECT chat_id as "chatId", message_id as "messageId", delete_at as "deleteAt", retry_count as "retryCount"
             FROM bot_message_deletion_queue
             WHERE delete_at <= $1 AND status = 'pending'
             ORDER BY delete_at ASC
             LIMIT 50
             FOR UPDATE SKIP LOCKED`,
            [now]
          );
          for (const row of res.rows) {
            jobsToProcess.push({
              chatId: Number(row.chatId),
              messageId: Number(row.messageId),
              deleteAt: Number(row.deleteAt),
              createdAt: 0,
              retryCount: Number(row.retryCount || 0),
              status: "pending"
            });
          }
        } catch (err) {
          console.warn("Postgres query failed during deletion process:", err);
        }
      }

      if (jobsToProcess.length === 0) {
        for (const job of this.localQueue.values()) {
          if (job.status === "pending" && job.deleteAt <= now) {
            jobsToProcess.push(job);
            if (jobsToProcess.length >= 50) break;
          }
        }
      }

      for (const job of jobsToProcess) {
        const key = `${job.chatId}:${job.messageId}`;
        let success = false;

        try {
          if (botOrTelegram) {
            const tg = botOrTelegram.telegram ?? botOrTelegram;
            await tg.deleteMessage(job.chatId, job.messageId);
            success = true;
          } else {
            const token = process.env.BOT_TOKEN || BOT_TOKEN_DEFAULT;
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
                const data = (await res.json().catch(() => ({}))) as { description?: string };
                const desc = data.description || "";
                if (
                  desc.includes("message to delete not found") ||
                  desc.includes("message can't be deleted") ||
                  desc.includes("chat not found")
                ) {
                  success = true;
                } else {
                  throw new Error(desc || `HTTP ${res.status}`);
                }
              } else {
                success = true;
              }
            }
          }
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          if (
            errMsg.includes("message to delete not found") ||
            errMsg.includes("message can't be deleted") ||
            errMsg.includes("chat not found")
          ) {
            success = true;
          } else {
            errorCount++;
            job.retryCount = (job.retryCount || 0) + 1;
            job.lastError = errMsg;

            if (job.retryCount >= 5) {
              job.status = "failed";
            } else {
              job.deleteAt = now + 1000 * Math.pow(2, job.retryCount);
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
            } catch (err) {
              console.warn("Failed to mark completed job in Postgres:", err);
            }
          }
        } else {
          if (this.isPostgresAvailable && this.pool) {
            try {
              await this.pool.query(
                `UPDATE bot_message_deletion_queue
                 SET retry_count = $1, delete_at = $2, status = $3, last_error = $4
                 WHERE chat_id = $5 AND message_id = $6`,
                [job.retryCount, job.deleteAt, job.status, job.lastError, job.chatId, job.messageId]
              );
            } catch {}
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 35));
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

  async purgeChatMessages(chatId: number, botOrTelegram?: any): Promise<number> {
    const tg = botOrTelegram?.telegram ?? botOrTelegram;
    let purged = 0;
    const messageIds: number[] = [];

    await this.ensurePostgres();
    if (this.isPostgresAvailable && this.pool) {
      try {
        const res = await this.pool.query(
          `SELECT message_id as "messageId" FROM bot_message_deletion_queue WHERE chat_id = $1 AND status = 'pending'`,
          [chatId]
        );
        for (const row of res.rows) {
          messageIds.push(Number(row.messageId));
        }
      } catch {}
    }

    for (const job of this.localQueue.values()) {
      if (job.chatId === chatId && job.status === "pending") {
        if (!messageIds.includes(job.messageId)) {
          messageIds.push(job.messageId);
        }
      }
    }

    for (const msgId of messageIds) {
      try {
        if (tg) {
          await tg.deleteMessage(chatId, msgId);
        } else {
          const token = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || BOT_TOKEN_DEFAULT;
          await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, message_id: msgId })
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
    return this.localQueue.size;
  }
}

export const messageDeletionService = new MessageDeletionService();

export interface SendBotMessageOptions {
  parse_mode?: "Markdown" | "HTML";
  reply_markup?: any;
  ttlMs?: number; // Defaults to SIX_HOURS_MS (6 hours)
}

/**
 * Universal, rock-solid bot message dispatcher for all Eye Radar outgoing messages.
 * Sends message to Telegram API with markdown retry fallback, records the message in
 * Neon Postgres deletion queue, and guarantees automatic deletion after TTL.
 */
export async function sendBotMessage(
  chatId: number | string,
  text: string,
  options?: SendBotMessageOptions
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const token = process.env.BOT_TOKEN || BOT_TOKEN_DEFAULT;
  const ttlMs = options?.ttlMs ?? SIX_HOURS_MS;

  try {
    const payload: Record<string, any> = {
      chat_id: chatId,
      text
    };
    if (options?.parse_mode !== undefined) {
      payload.parse_mode = options.parse_mode;
    } else {
      payload.parse_mode = "Markdown";
    }
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

    // Auto-retry without markdown if formatting was malformed
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
      console.error(`[sendBotMessage] Telegram API error (chat ${chatId}):`, errText);
      return { ok: false, error: errText };
    }

    const messageId = data.result.message_id;
    await messageDeletionService.scheduleDeletion(Number(chatId), messageId, ttlMs);
    return { ok: true, messageId };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error(`[sendBotMessage] exception (chat ${chatId}):`, errMsg);
    return { ok: false, error: errMsg };
  }
}

