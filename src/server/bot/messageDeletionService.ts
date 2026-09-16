// src/server/bot/messageDeletionService.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

export interface DeletionJob {
  chatId: number;
  messageId: number;
  deleteAt: number; // Unix timestamp ms (sentAt + 6h)
  createdAt: number;
  retryCount: number;
  status: "pending" | "failed";
  lastError?: string;
}

export const SIX_HOURS_MS = 6 * 60 * 60 * 1000; // Exactly 6 hours (21,600,000 ms)

export class MessageDeletionService {
  private pool: pg.Pool | null = null;
  private isPostgresAvailable = false;
  private localQueue = new Map<string, DeletionJob>();
  private readonly storagePath: string;
  private isProcessing = false;

  constructor(customStoragePath?: string) {
    this.storagePath = customStoragePath || resolve(process.cwd(), "data", "message_deletion_queue.json");
    this.initLocalStore();
    this.initPostgres();
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

  private async initPostgres(): Promise<void> {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      return;
    }

    try {
      this.pool = new Pool({
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
            delete_at BIGINT NOT NULL,
            created_at BIGINT NOT NULL,
            retry_count INT DEFAULT 0,
            status VARCHAR(20) DEFAULT 'pending',
            last_error TEXT,
            PRIMARY KEY (chat_id, message_id)
          );
          CREATE INDEX IF NOT EXISTS idx_bmdq_delete_at ON bot_message_deletion_queue (delete_at) WHERE status = 'pending';
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
      deleteAt,
      createdAt: now,
      retryCount: 0,
      status: "pending"
    };

    this.localQueue.set(key, job);
    this.persistLocalStore();

    if (this.isPostgresAvailable && this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO bot_message_deletion_queue (chat_id, message_id, delete_at, created_at, retry_count, status)
           VALUES ($1, $2, $3, $4, 0, 'pending')
           ON CONFLICT (chat_id, message_id) DO NOTHING`,
          [chatId, messageId, deleteAt, now]
        );
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

      if (this.isPostgresAvailable && this.pool) {
        try {
          const res = await this.pool.query(
            `SELECT chat_id as "chatId", message_id as "messageId", delete_at as "deleteAt", retry_count as "retryCount"
             FROM bot_message_deletion_queue
             WHERE delete_at <= $1 AND status = 'pending'
             ORDER BY delete_at ASC
             LIMIT 50`,
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
            const token = env.botToken;
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
                `DELETE FROM bot_message_deletion_queue WHERE chat_id = $1 AND message_id = $2`,
                [job.chatId, job.messageId]
              );
            } catch (err) {
              console.warn("Failed to delete processed job from Postgres:", err);
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

  getQueueSize(): number {
    return this.localQueue.size;
  }
}

export const messageDeletionService = new MessageDeletionService();
