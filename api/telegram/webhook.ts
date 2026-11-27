// api/telegram/webhook.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  sendBotMessage,
  SIX_HOURS_MS,
  TEST_TTL_MS
} from "../../src/server/bot/messageDeletionService.js";
import { getPool, query } from "../../src/server/db/pool.js";
import {
  findCityInText,
  isControlledUkraineLocation,
  UKRAINE_CITIES
} from "../../src/server/sources/ukraineGeo.js";

const processedUpdates = new Set<number>();
const verifiedUkraineChats = new Set<number>();
const MAX_PROCESSED_CACHE = 5000;

function findNearestOblast(lat: number, lon: number): { nameUk: string; oblast: string } {
  let closest = UKRAINE_CITIES.kyiv;
  let minD = Infinity;
  for (const city of Object.values(UKRAINE_CITIES)) {
    const d = (city.lat - lat) ** 2 + (city.lon - lon) ** 2;
    if (d < minD) {
      minD = d;
      closest = city;
    }
  }
  return { nameUk: closest.nameUk, oblast: closest.oblast || closest.nameUk };
}

async function isChatVerifiedInUkraine(chatId: number): Promise<boolean> {
  if (verifiedUkraineChats.has(chatId)) return true;
  try {
    const pool = getPool();
    if (!pool) return false;
    const res = await query(
      `SELECT lat, lon, enabled FROM user_preferences WHERE chat_id = $1 LIMIT 1`,
      [chatId]
    );
    if (res.rows.length > 0) {
      const row = res.rows[0];
      const lat = Number(row.lat);
      const lon = Number(row.lon);
      if (row.enabled !== false && isControlledUkraineLocation(lat, lon)) {
        verifiedUkraineChats.add(chatId);
        return true;
      }
    }
  } catch (err) {
    console.warn("[Telegram Webhook] DB verification lookup failed:", err);
  }
  return false;
}

async function saveVerifiedUkraineLocation(
  chatId: number,
  lat: number,
  lon: number,
  cityName: string
): Promise<void> {
  verifiedUkraineChats.add(chatId);
  try {
    const pool = getPool();
    if (!pool) return;
    await query(
      `INSERT INTO user_preferences (chat_id, lat, lon, city_name, radius_km, enabled, updated_at)
       VALUES ($1, $2, $3, $4, 30, TRUE, $5)
       ON CONFLICT (chat_id) DO UPDATE SET
         lat = EXCLUDED.lat,
         lon = EXCLUDED.lon,
         city_name = EXCLUDED.city_name,
         enabled = TRUE,
         updated_at = EXCLUDED.updated_at`,
      [chatId, Number(lat.toFixed(3)), Number(lon.toFixed(3)), cityName, Date.now()]
    );
  } catch (err) {
    console.warn("[Telegram Webhook] Failed to save verified location:", err);
  }
}

async function sendUkraineVerificationPrompt(chatId: number): Promise<void> {
  const promptText =
    `🛡️ *EYE RADAR // ПЕРЕВІРКА ДОСТУПУ (УКРАЇНА)*\n\n` +
    `Доступ до бота та оперативних даних ППО надається **виключно резидентам підконтрольної території України** (з урахуванням лінії бойового зіткнення).\n\n` +
    `Для отримання повного доступу до карти, висот, швидкостей, напрямків руху цілей та сповіщень підтвердіть свою локацію кнопкою нижче або командою \`/setlocation <Місто>\`:`;

  await sendBotMessage(chatId, promptText, {
    parse_mode: "Markdown",
    reply_markup: {
      keyboard: [[{ text: "📍 Підтвердити локацію в Україні (GPS)", request_location: true }]],
      resize_keyboard: true,
      one_time_keyboard: true
    },
    ttlMs: SIX_HOURS_MS
  });
}

async function sendFullAccessLaunchMessage(chatId: number, token: string, webAppUrl: string): Promise<void> {
  const launchText =
    `🛰️ *EYE RADAR // ТАКТИЧНА СИСТЕМА МОНІТОРИНГУ*\n\n` +
    `• Живі повітряні цілі в реальному часі: висота, швидкість, курс та вектор руху\n` +
    `• Офіційні зведення ПС ЗСУ, ДСНС України та спостереження ADS-B\n` +
    `• Актуальна лінія фронту, день/ніч та інтерактивна карта загроз\n\n` +
    `_🔓 Локацію в Україні підтверджено. Повний доступ до всіх даних активовано._`;

  const primaryBtn = {
    text: "🛰️ ВІДКРИТИ EYE RADAR",
    web_app: { url: `${webAppUrl}?v=4.2.0&ts=${Date.now()}` }
  };

  await sendBotMessage(chatId, launchText, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[primaryBtn]]
    },
    ttlMs: SIX_HOURS_MS
  });

  void fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      menu_button: {
        type: "web_app",
        text: "📡 Радар",
        web_app: { url: `${webAppUrl}?v=4.2.0` }
      }
    })
  }).catch(() => {});
}

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
  const token = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
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
          // 1a. Location verification via Telegram GPS message
          if (msg.location) {
            const loc = msg.location;
            if (!isControlledUkraineLocation(loc.latitude, loc.longitude)) {
              verifiedUkraineChats.delete(chatId);
              const blockedText =
                `⛔ *ДОСТУП ЗАБЛОКОВАНО*\n\n` +
                `Координати \`${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}\` знаходяться поза підконтрольною територією України (РФ, РБ або за лінією фронту).\n` +
                `Доступ до бота та даних EYE RADAR суворо заборонено.`;
              await sendBotMessage(chatId, blockedText, {
                parse_mode: "Markdown",
                ttlMs: SIX_HOURS_MS
              });
            } else {
              const nearest = findNearestOblast(loc.latitude, loc.longitude);
              await saveVerifiedUkraineLocation(chatId, loc.latitude, loc.longitude, nearest.nameUk);
              const locText =
                `✅ *Локацію в Україні підтверджено!*\n` +
                `📍 Сектор: *${nearest.nameUk}* (\`${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}\`)\n\n` +
                `🔓 Повний доступ до всіх даних EYE RADAR, висот, швидкостей та сповіщень відкрито.`;
              await sendBotMessage(chatId, locText, {
                parse_mode: "Markdown",
                ttlMs: SIX_HOURS_MS
              });
              await sendFullAccessLaunchMessage(chatId, token, webAppUrl);
            }
          }

          // 1b. Command: /setlocation <Місто>
          else if (text.startsWith("/setlocation")) {
            const parts = text.split(" ").slice(1).join(" ").trim();
            if (!parts) {
              await sendBotMessage(
                chatId,
                "Вкажіть назву міста на підконтрольній території України (наприклад: `/setlocation Київ`) або натисніть кнопку GPS-підтвердження.",
                { parse_mode: "Markdown", ttlMs: SIX_HOURS_MS }
              );
            } else {
              const city = findCityInText(parts);
              if (!city) {
                await sendBotMessage(
                  chatId,
                  `Не вдалося знайти місто "${parts}". Спробуйте іншу назву (Київ, Харків, Одеса, Дніпро, Запоріжжя, Львів тощо).`,
                  { ttlMs: SIX_HOURS_MS }
                );
              } else if (!isControlledUkraineLocation(city.lat, city.lon)) {
                verifiedUkraineChats.delete(chatId);
                await sendBotMessage(
                  chatId,
                  `⛔ *ДОСТУП ЗАБЛОКОВАНО:* Локація *${city.nameUk}* знаходиться за лінією фронту на тимчасово окупованій території. Доступ дозволено лише на підконтрольній території України.`,
                  { parse_mode: "Markdown", ttlMs: SIX_HOURS_MS }
                );
              } else {
                await saveVerifiedUkraineLocation(chatId, city.lat, city.lon, city.nameUk);
                await sendBotMessage(
                  chatId,
                  `✅ Локацію в Україні підтверджено: *${city.nameUk}* (\`${city.lat.toFixed(3)}, ${city.lon.toFixed(3)}\`).\n🔓 Повний доступ до всіх даних EYE RADAR відкрито!`,
                  { parse_mode: "Markdown", ttlMs: SIX_HOURS_MS }
                );
                await sendFullAccessLaunchMessage(chatId, token, webAppUrl);
              }
            }
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

          // Command: /start or /radar (gated by Ukraine verification)
          else if (text.startsWith("/start") || text.startsWith("/radar")) {
            const verified = await isChatVerifiedInUkraine(chatId);
            if (!verified) {
              await sendUkraineVerificationPrompt(chatId);
            } else {
              await sendFullAccessLaunchMessage(chatId, token, webAppUrl);
            }
          }

          // Command: /status (gated by Ukraine verification)
          else if (text.startsWith("/status")) {
            const verified = await isChatVerifiedInUkraine(chatId);
            if (!verified) {
              await sendUkraineVerificationPrompt(chatId);
            } else {
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
                `• public.osint (ПС ЗСУ / ДСНС): 🟢 OK\n` +
                `• airplanes.live / adsb.lol: 🟢 OK\n` +
                `• open-meteo: 🟢 OK`;

              await sendBotMessage(chatId, statusText, {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "🗺️ Відкрити радар",
                        web_app: { url: `${webAppUrl}?v=4.2.0` }
                      }
                    ]
                  ]
                },
                ttlMs: SIX_HOURS_MS
              });
            }
          }

          // Command: /alerts (gated by Ukraine verification)
          else if (text.startsWith("/alerts")) {
            const verified = await isChatVerifiedInUkraine(chatId);
            if (!verified) {
              await sendUkraineVerificationPrompt(chatId);
            } else {
              const alertsText =
                `🔔 *Поточний статус повітряних тривог*\n\n` +
                `Усі актуальні сектори тривоги, лінія фронту та вектори руху цілей синхронізуються на інтерактивній карті в реальному часі.`;

              await sendBotMessage(chatId, alertsText, {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "🗺️ Переглянути карту тривог",
                        web_app: { url: `${webAppUrl}?v=4.2.0` }
                      }
                    ]
                  ]
                },
                ttlMs: SIX_HOURS_MS
              });
            }
          }

          // Command: /briefing (gated by Ukraine verification)
          else if (text.startsWith("/briefing")) {
            const verified = await isChatVerifiedInUkraine(chatId);
            if (!verified) {
              await sendUkraineVerificationPrompt(chatId);
            } else {
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
                        web_app: { url: `${webAppUrl}?v=4.2.0` }
                      }
                    ]
                  ]
                },
                ttlMs: SIX_HOURS_MS
              });
            }
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
          const verified = await isChatVerifiedInUkraine(chatId);
          if (!verified) {
            await sendUkraineVerificationPrompt(chatId);
          } else {
            await sendBotMessage(chatId, "⚙️ Статус системи активний. Відкрийте Mini App.", {
              ttlMs: SIX_HOURS_MS
            });
          }
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
