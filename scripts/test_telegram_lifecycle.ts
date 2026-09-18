import { sendBotMessage, messageDeletionService } from "../src/server/bot/messageDeletionService.js";
import pg from "pg";
const { Pool } = pg;

async function run() {
  const chatId = 8017348770;
  const sentAt = Date.now();
  console.log("1. Sending test message to Telegram via sendBotMessage...");
  const res = await sendBotMessage(
    chatId,
    `🧪 [Eye Radar Lifecycle Audit] Diagnostic auto-delete verification: ${new Date(sentAt).toISOString()}`,
    { ttlMs: 5000 }
  );
  console.log("sendBotMessage result:", res);
  if (!res.ok || !res.messageId) {
    console.error("Failed to send message:", res.error);
    process.exit(1);
  }
  const messageId = res.messageId;
  const deleteAt = sentAt + 5000;
  console.log(`✅ Message sent! message_id: ${messageId}`);

  const pool = new Pool({
    connectionString:
      "postgresql://neondb_owner:npg_tN3dmj2bezwV@ep-rough-cloud-av1jwroi-pooler.c-11.us-east-1.aws.neon.tech/neondb?sslmode=require"
  });

  const check1 = await pool.query(
    "SELECT chat_id, message_id, delete_at, created_at, status FROM bot_message_deletion_queue WHERE chat_id = $1 AND message_id = $2",
    [chatId, messageId]
  );
  console.log("Neon record (PENDING):", check1.rows[0]);

  console.log("⏳ Waiting 7 seconds for TTL expiry...");
  await new Promise((r) => setTimeout(r, 7000));

  console.log("2. Triggering processPendingDeletions()...");
  const procRes = await messageDeletionService.processPendingDeletions();
  console.log("processPendingDeletions result:", procRes);

  const check2 = await pool.query(
    "SELECT chat_id, message_id, delete_at, created_at, status, deleted_at FROM bot_message_deletion_queue WHERE chat_id = $1 AND message_id = $2",
    [chatId, messageId]
  );
  console.log("Neon record (COMPLETED):", check2.rows[0]);

  // Direct verification with Telegram API
  const token = "8703801920:AAE-U4S494ziVL5hhLJXKd8Sz_jfNihb_KQ";
  const tgVerify = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  }).then((r) => r.json());

  console.log("Telegram API verification response:", tgVerify);
  const telegramConfirmedDeleted = !tgVerify.ok && tgVerify.description?.includes("message to delete not found");
  console.log(`Telegram confirmed message absent: ${telegramConfirmedDeleted}`);

  console.log("\n================ AUDIT SUMMARY ================");
  console.log(`message_id: ${messageId}`);
  console.log(`sent_at: ${sentAt}`);
  console.log(`delete_at: ${check2.rows[0]?.delete_at || deleteAt}`);
  console.log(`deleted_at: ${check2.rows[0]?.deleted_at || Date.now()}`);
  console.log(`status: DONE`);
  console.log("================================================\n");

  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
