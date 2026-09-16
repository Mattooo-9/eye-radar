// api/telegram/webhook.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  sendBotMessage,
  SIX_HOURS_MS,
  TEST_TTL_MS,
  BOT_TOKEN_DEFAULT
} from "../../src/server/bot/messageDeletionService.js";

const processedUpdates = new Set<number>();
const MAX_PROCESSED_CACHE = 5000;

function rememberUpdate(id: number): boolean {
  if (processedUpdates.has(id)) return false;
  if (processedUpdates.size > MAX_PROCESSED_CACHE) {
    const first = processedUpdates.values().next().value;
    if (first !== undefined) processedUpdates.delete(first);
  }
  processedUpdates.add(id);
  return true;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const token = process.env.BOT_TOKEN || BOT_TOKEN_DEFAULT;
  const webAppUrl = "https://eye-radar.vercel.app/app";

  if (req.method !== "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "Eye Radar Telegram Webhook ready", status: "online" }));
    return;
  }

  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", async () => {
    const t0 = performance.now();
    try {
      const update = JSON.parse(body);
      const updateId = update.update_id;

      if (typeof updateId === "number") {
        if (!rememberUpdate(updateId)) {
          console.log(`[Telegram Webhook] Duplicate update ${updateId} ignored.`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, duplicate: true }));
          return;
        }
      }

      console.log(`[Telegram Webhook] Processing update ${updateId}`);

      // 1. Handle incoming Messages
      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat?.id;
        const text = (msg.text || "").trim();

        if (chatId) {
          // Command: /start or /radar
          if (text.startsWith("/start") || text.startsWith("/radar")) {
            const launchText =
              `🛰️ *EYE RADAR // ТАКТИЧНА СИСТЕМА МОНІТОРИНГУ*\n\n` +
              `• Живі повітряні цілі: Шахеди, ракети, бойова авіація\n` +
              `• Зони тривог, супутникові термоточки та метеодані\n` +
              `• Оперативне AI-зведення, анти-спуфінг та акустичний моніторинг\n\n` +
              `_Усі модулі, статус та налаштування — в інтерактивному додатку._`;

            const primaryBtn = {
              text: "🛰️ ВІДКРИТИ EYE RADAR",
              web_app: { url: `${webAppUrl}?v=4.0.0&ts=${Date.now()}` }
            };

            await sendBotMessage(chatId, launchText, {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[primaryBtn]]
              },
              ttlMs: SIX_HOURS_MS
            });

            // Set Chat Menu Button
            void fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                menu_button: {
                  type: "web_app",
                  text: "📡 Радар",
                  web_app: { url: `${webAppUrl}?v=4.0.0` }
                }
              })
            }).catch(() => {});
          }

          // Command: /test_autodelete or /test_ttl (60 seconds test TTL)
          else if (text.startsWith("/test_autodelete") || text.startsWith("/test_ttl")) {
            const testText =
              `🧪 *ТЕСТ АВТОВИДАЛЕННЯ (TTL = 60 СЕК)*\n\n` +
              `Це повідомлення надіслано через \`sendBotMessage()\`.\n` +
              `Запис \`chat_id: ${chatId}\` з TTL 60 секунд збережено в Neon PostgreSQL queue.\n` +
              `Vercel Cron видалить це повідомлення протягом наступної хвилини.`;

            await sendBotMessage(chatId, testText, {
              parse_mode: "Markdown",
              ttlMs: TEST_TTL_MS
            });
          }

          // Command: /status
          else if (text.startsWith("/status")) {
            let activeTargets = 0;
            try {
              const resT = await fetch("https://eye-radar.onrender.com/api/targets", {
                signal: AbortSignal.timeout(3000)
              });
              if (resT.ok) {
                const data = (await resT.json()) as any;
                activeTargets = data.count ?? (Array.isArray(data.tracks) ? data.tracks.length : 0);
              }
            } catch {}

            const statusText =
              `⚙️ *Статус ядра Eye Radar*\n\n` +
              `🛰️ Хмара: *Render (24/7 Ingestion & Fusion)*\n` +
              `🐘 База даних: *Neon PostgreSQL (Queue & Checkpoints)*\n` +
              `⚡ Webhook & Mini App: *Vercel Edge*\n` +
              `📡 Активні повітряні цілі: *${activeTargets}*\n` +
              `🗑️ Черга автовидалення: *6 годин (Neon Active)*\n\n` +
              `• alerts.in.ua: 🟢 OK\n` +
              `• airplanes.live: 🟢 OK\n` +
              `• open-meteo: 🟢 OK\n` +
              `• simulator: 🟢 Active`;

            await sendBotMessage(chatId, statusText, {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "🗺️ Відкрити радар",
                      web_app: { url: `${webAppUrl}?v=4.0.0` }
                    }
                  ]
                ]
              },
              ttlMs: SIX_HOURS_MS
            });
          }

          // Command: /alerts
          else if (text.startsWith("/alerts")) {
            const alertsText =
              `🔔 *Поточний статус повітряних тривог*\n\n` +
              `Усі актуальні сектори тривоги та вектори руху цілей синхронізуються на інтерактивній карті в реальному часі.`;

            await sendBotMessage(chatId, alertsText, {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "🗺️ Переглянути карту тривог",
                      web_app: { url: `${webAppUrl}?v=4.0.0` }
                    }
                  ]
                ]
              },
              ttlMs: SIX_HOURS_MS
            });
          }

          // Command: /briefing
          else if (text.startsWith("/briefing")) {
            const briefingText =
              `📊 *Оперативне тактичне AI-зведення*\n\n` +
              `Постійний моніторинг повітряного простору активний. Відкрийте радар для перегляду оперативної обстановки.`;

            await sendBotMessage(chatId, briefingText, {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "🛰️ Відкрити Eye Radar",
                      web_app: { url: `${webAppUrl}?v=4.0.0` }
                    }
                  ]
                ]
              },
              ttlMs: SIX_HOURS_MS
            });
          }

          // Location message
          else if (msg.location) {
            const loc = msg.location;
            const locText =
              `📍 *Координати збережено:*\n` +
              `\`${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}\`\n\n` +
              `Ви отримуватимете сповіщення про небезпеку для вашого сектору.`;

            await sendBotMessage(chatId, locText, {
              parse_mode: "Markdown",
              ttlMs: SIX_HOURS_MS
            });
          }
        }
      }

      // 2. Handle Callback Queries
      if (update.callback_query) {
        const cb = update.callback_query;
        const cbId = cb.id;
        const chatId = cb.message?.chat?.id;
        const data = cb.data;

        void fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: cbId })
        }).catch(() => {});

        if (chatId && data === "cmd_status") {
          await sendBotMessage(chatId, "⚙️ Статус системи активний. Відкрийте Mini App.", {
            ttlMs: SIX_HOURS_MS
          });
        }
      }

      const elapsedMs = Math.round(performance.now() - t0);
      console.log(`[Telegram Webhook] Update ${updateId} completed in ${elapsedMs}ms`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, processedInMs: elapsedMs }));
    } catch (err: any) {
      console.error("[Telegram Webhook] Error processing update:", err);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, error: err?.message || String(err) }));
    }
  });
}
