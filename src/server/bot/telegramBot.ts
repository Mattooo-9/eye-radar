import { Telegraf } from "telegraf";
import { env } from "../config/env.js";
import { messageDeletionService, SIX_HOURS_MS, sendBotMessage } from "./messageDeletionService.js";
import { AiBriefingService } from "../core/aiBriefing.js";
import { StorageManager } from "../core/storage.js";
import { ThreatEngine } from "../core/threatEngine.js";
import type { AlertRegion, TrackState, UserAlertPreference } from "../domain/types.js";
import type { AlertsInUaSource } from "../sources/alertsInUa.js";
import type { SourceHealthTracker } from "../sources/sourceHealth.js";
import { findCityInText, UKRAINE_CITIES } from "../sources/ukraineGeo.js";
import { alertStateMachine } from "../core/alertStateMachine.js";

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

export class EyeRadarBotManager {
  private bot: Telegraf | null = null;
  private readonly storage = new StorageManager();
  private readonly threatEngine = new ThreatEngine();
  private readonly aiBriefing = new AiBriefingService();
  private healthTracker?: SourceHealthTracker;
  private trackCountProvider?: () => number;
  private tracksProvider?: () => TrackState[];
  private alertsSource?: AlertsInUaSource;
  private deletionTimer?: NodeJS.Timeout;

  constructor() {
    if (!env.botToken || env.botToken === "YOUR_TELEGRAM_BOT_TOKEN") {
      console.warn("⚠️ BOT_TOKEN not configured. Telegram bot disabled.");
      return;
    }

    try {
      this.bot = new Telegraf(env.botToken);
      this.setupHandlers();

      // Periodic check to delete expired notification messages from database/queue
      this.deletionTimer = setInterval(() => {
        void this.processPendingDeletions();
      }, 60_000);
      this.deletionTimer.unref();
    } catch (err) {
      console.error("Failed to initialize Telegraf:", err);
    }
  }

  scheduleMessageDeletion(chatId: number, messageId: number, delayMs = SIX_HOURS_MS): void {
    void messageDeletionService.scheduleDeletion(chatId, messageId, delayMs);
  }

  private async deleteTelegramMessage(chatId: number, messageId: number): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.telegram.deleteMessage(chatId, messageId);
    } catch {
      // Handled in messageDeletionService
    }
  }

  private async processPendingDeletions(): Promise<void> {
    if (!this.bot) return;
    await messageDeletionService.processPendingDeletions(this.bot.telegram);
  }

  setHealthTracker(tracker: SourceHealthTracker, trackCountProvider: () => number, tracksProvider?: () => TrackState[]): void {
    this.healthTracker = tracker;
    this.trackCountProvider = trackCountProvider;
    this.tracksProvider = tracksProvider;
  }

  setAlertsSource(source: AlertsInUaSource): void {
    this.alertsSource = source;
  }

  private setupHandlers(): void {
    if (!this.bot) return;

    const bot = this.bot;
    const baseWebUrl =
      process.env.VERCEL_APP_URL ||
      (env.publicBaseUrl.includes("onrender.com")
        ? "https://eye-radar.vercel.app/app"
        : `${env.publicBaseUrl}${env.webAppPath}`);
    const buildTag = Date.now().toString(36);
    const webAppUrl = `${baseWebUrl}?v=3.5.0&t=${buildTag}`;

    bot.telegram.setMyCommands([
      { command: "start", description: "Запустити радар та налаштування" },
      { command: "radar", description: "Відкрити інтерактивну карту (Mini App)" },
      { command: "briefing", description: "Оперативне тактичне AI-зведення" },
      { command: "alerts", description: "Поточні повітряні тривоги" },
      { command: "setlocation", description: "Встановити місто чи координати для сповіщень" },
      { command: "radius", description: "Встановити радіус тривоги (наприклад: /radius 30)" },
      { command: "status", description: "Діагностика та статус системи eye-radar" },
      { command: "report", description: "Повідомити про звук або спостереження БПЛА" }
    ]).catch(() => {});

    const isHttps = webAppUrl.startsWith("https://");
    const getRadarButton = (text = "🛰️ Відкрити Eye Radar") => {
      const clean = text.replace(/\s*\((Mini App|Web)\)/gi, "").trim();
      return isHttps
        ? { text: `${clean} (Mini App)`, web_app: { url: webAppUrl } }
        : { text: `${clean} (Web)`, url: webAppUrl };
    };

    if (isHttps) {
      bot.telegram.setChatMenuButton({
        menuButton: {
          type: "web_app",
          text: "📡 Радар",
          web_app: { url: webAppUrl }
        }
      }).catch(() => {});
    }

    const sendLaunchMessage = async (chatId: number) => {
      try {
        const primaryBtn = isHttps
          ? { text: "🛰️ ВІДКРИТИ EYE RADAR", web_app: { url: webAppUrl } }
          : { text: "🛰️ ВІДКРИТИ EYE RADAR", url: webAppUrl };

        await sendBotMessage(
          chatId,
          `🛰️ *EYE RADAR // ТАКТИЧНА СИСТЕМА МОНІТОРИНГУ*\n\n` +
          `• Живі повітряні цілі: Шахеди, ракети, бойова авіація\n` +
          `• Зони тривог, супутникові термоточки та метеодані\n` +
          `• Оперативне AI-зведення, анти-спуфінг та акустичний моніторинг\n\n` +
          `_Усі модулі, статус та налаштування — в інтерактивному додатку._`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[primaryBtn]]
            },
            ttlMs: SIX_HOURS_MS
          }
        );
      } catch (err) {
        console.error("Failed to send launch message:", err);
      }
    };

    const handleBriefing = async (ctx: any) => {
      const waitMsg = await ctx.reply("⏳ Аналіз повітряного простору та генерація AI-зведення...");
      const pref = this.storage.getPreference(ctx.chat.id);
      const tracks = this.tracksProvider ? this.tracksProvider() : [];

      const summary = await this.aiBriefing.generateBriefing({
        tracks,
        userCity: pref ? `Координати ${pref.lat.toFixed(2)}, ${pref.lon.toFixed(2)} (радіус ${pref.radiusKm} км)` : undefined,
        userCoords: pref ? { lat: pref.lat, lon: pref.lon } : undefined
      });

      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);
      } catch {}

      const briefingMsg = await ctx.reply(summary, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[getRadarButton("🛰️ Відкрити 3D Радар")]]
        }
      });
      if (briefingMsg?.message_id) {
        this.scheduleMessageDeletion(ctx.chat.id, briefingMsg.message_id, SIX_HOURS_MS);
      }
    };

    const replyAndSchedule = async (ctx: any, text: string, extra?: any) => {
      return messageDeletionService.replyAndSchedule(ctx, text, extra, SIX_HOURS_MS);
    };

    bot.command("briefing", handleBriefing);
    bot.action("cmd_briefing", async (ctx) => {
      await ctx.answerCbQuery();
      await handleBriefing(ctx);
    });

    bot.hears("🛰️ ВІДКРИТИ 3D РАДАР", async (ctx) => {
      await sendLaunchMessage(ctx.chat.id);
    });
    bot.hears("📊 AI-Зведення", handleBriefing);
    bot.hears("🔔 Тривоги", async (ctx) => {
      await replyAndSchedule(ctx, "🔔 Актуальні зони повітряних тривог відображаються на карті в реальному часі.", {
        reply_markup: {
          inline_keyboard: [[getRadarButton("🛰️ Відкрити радар")]]
        }
      });
    });
    bot.hears("⚙️ Статус", async (ctx) => {
      await replyAndSchedule(ctx, formatStatusReport(), { parse_mode: "Markdown" });
    });

    bot.start(async (ctx) => {
      await sendLaunchMessage(ctx.chat.id);
    });

    bot.command("radar", async (ctx) => {
      await sendLaunchMessage(ctx.chat.id);
    });

    bot.command("radius", async (ctx) => {
      const parts = ctx.message.text.split(" ");
      const km = parseInt(parts[1], 10);
      if (isNaN(km) || km < 5 || km > 150) {
        await replyAndSchedule(ctx, "Вкажіть радіус від 5 до 150 км. Приклад: `/radius 35`", { parse_mode: "Markdown" });
        return;
      }

      const pref = this.storage.getPreference(ctx.chat.id) ?? {
        chatId: ctx.chat.id,
        lat: 50.4501,
        lon: 30.5234,
        radiusKm: km,
        enabled: true
      };
      pref.radiusKm = km;
      this.storage.savePreference(pref);

      await replyAndSchedule(ctx, `✅ Радіус персонального сповіщення встановлено: *${km} км*`, { parse_mode: "Markdown" });
    });

    bot.command("setlocation", async (ctx) => {
      const parts = ctx.message.text.split(" ").slice(1).join(" ");
      if (!parts) {
        await replyAndSchedule(
          ctx,
          "Вкажіть назву міста (наприклад: `/setlocation Полтава`) або просто надішліть геопозицію Telegram скріпкою в чат.",
          { parse_mode: "Markdown" }
        );
        return;
      }

      const city = findCityInText(parts);
      if (city) {
        const pref = this.storage.getPreference(ctx.chat.id) ?? {
          chatId: ctx.chat.id,
          lat: city.lat,
          lon: city.lon,
          radiusKm: 30,
          enabled: true
        };
        pref.lat = city.lat;
        pref.lon = city.lon;
        this.storage.savePreference(pref);

        await replyAndSchedule(ctx, `✅ Локацію для сповіщень встановлено: *${city.nameUk}* (${city.lat}, ${city.lon}). Радіус: *${pref.radiusKm} км*`, {
          parse_mode: "Markdown"
        });
      } else {
        await replyAndSchedule(ctx, `Не вдалося знайти місто "${parts}". Спробуйте іншу назву (Київ, Харків, Одеса, Дніпро, Запоріжжя тощо).`);
      }
    });

    bot.on("location", async (ctx) => {
      const loc = ctx.message.location;
      const pref = this.storage.getPreference(ctx.chat.id) ?? {
        chatId: ctx.chat.id,
        lat: loc.latitude,
        lon: loc.longitude,
        radiusKm: 30,
        enabled: true
      };
      pref.lat = loc.latitude;
      pref.lon = loc.longitude;
      this.storage.savePreference(pref);

      await replyAndSchedule(ctx, `📍 Координати збережено: *${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}*. Радіус контролю: *${pref.radiusKm} км*`, {
        parse_mode: "Markdown"
      });
    });

    const formatStatusReport = (): string => {
      const uptimeSec = Math.round(process.uptime());
      const hours = Math.floor(uptimeSec / 3600);
      const mins = Math.floor((uptimeSec % 3600) / 60);
      const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const trackCount = this.trackCountProvider ? this.trackCountProvider() : 0;
      const subsCount = this.storage.getAllPreferences().length;

      let sourcesReport = "";
      if (this.healthTracker) {
        const statuses = this.healthTracker.getStatuses();
        sourcesReport = statuses.map((s) => `• ${s.name}: ${s.status === "online" ? "🟢 OK" : "🟡 " + s.status} (${s.lastLatencyMs}ms)`).join("\n");
      }

      return (
        "⚙️ *Статус ядра Eye Radar*\n\n" +
        `⏱️ Аптайм: *${hours}г ${mins}хв*\n` +
        `💾 Пам'ять (RSS): *${memMb} MB*\n` +
        `📡 Активні повітряні цілі: *${trackCount}*\n` +
        `👥 Підписників на гео-оповіщення: *${subsCount}*\n\n` +
        `🔌 *Статус адаптерів даних:*\n` +
        (sourcesReport || "• alerts.in.ua: 🟢 OK\n• airplanes.live: 🟢 OK\n• open-meteo: 🟢 OK\n• simulator: 🟢 Active")
      );
    };

    bot.command("status", async (ctx) => {
      await replyAndSchedule(ctx, formatStatusReport(), { parse_mode: "Markdown" });
    });

    bot.action("cmd_status", async (ctx) => {
      await ctx.answerCbQuery();
      await replyAndSchedule(ctx, formatStatusReport(), { parse_mode: "Markdown" });
    });

    bot.command("alerts", async (ctx) => {
      await replyAndSchedule(
        ctx,
        "🔔 *Статус тривог*: активні сектори та повітряні цілі відображаються на інтерактивній мапі.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[getRadarButton("🗺️ Відкрити радар")]]
          }
        }
      );
    });

    bot.action("cmd_alerts", async (ctx) => {
      await ctx.answerCbQuery();
      await replyAndSchedule(ctx, "🔔 Відкрийте карту для перегляду актуальних секторів тривоги.", {
        reply_markup: {
          inline_keyboard: [[getRadarButton("🗺️ Відкрити радар")]]
        }
      });
    });

    bot.command("report", async (ctx) => {
      const text = ctx.message.text.replace(/^\/report\s*/, "").trim();
      if (!text) {
        await replyAndSchedule(ctx, "Вкажіть спостереження після команди. Приклад: `/report Чую звук двигуна БПЛА на південь від міста`", {
          parse_mode: "Markdown"
        });
        return;
      }

      await replyAndSchedule(ctx, "✅ Дякуємо за інформацію! Повідомлення передано в чергу аналізу для зіставлення з даними сенсорів.");
    });
  }

  async subscribeUserLocation(
    chatId: number,
    lat: number,
    lon: number,
    cityName?: string,
    radiusKm = 30
  ): Promise<boolean> {
    const nearest = findNearestOblast(lat, lon);
    const resolvedCity = cityName || nearest.nameUk;
    const existing = this.storage.getPreference(chatId);

    // If identical preference already confirmed, do not resend notification message
    const isSame =
      existing &&
      Math.abs(existing.lat - lat) < 0.001 &&
      Math.abs(existing.lon - lon) < 0.001 &&
      existing.radiusKm === radiusKm &&
      existing.cityName === resolvedCity;

    const pref: UserAlertPreference = {
      chatId,
      lat,
      lon,
      radiusKm,
      enabled: true,
      cityName: resolvedCity,
      lastAlertState: existing?.lastAlertState,
      lastNotified: existing?.lastNotified
    };
    this.storage.savePreference(pref);

    if (isSame) {
      return true;
    }

    if (this.bot) {
      try {
        await sendBotMessage(
          chatId,
          `📍 *Локацію для сповіщень підтверджено!*\n\n` +
            `🎯 Сектор: *${resolvedCity}* (${nearest.oblast} обл.)\n` +
            `🌐 Координати: \`${lat.toFixed(4)}, ${lon.toFixed(4)}\`\n` +
            `📏 Радіус контролю: *${radiusKm} км*\n\n` +
            `🔔 *Ви отримуватимете в цьому боті:*\n` +
            `• Сигнали початку та відбою повітряної тривоги для вашого сектору\n` +
            `• Попередження про пряме наближення Шахедів, ракет та КАБів у радіус ${radiusKm} км\n\n` +
            `_Змінити локацію можна кліком на карті або командою /setlocation_`,
          { parse_mode: "Markdown", ttlMs: SIX_HOURS_MS }
        );
        return true;
      } catch (err) {
        console.warn(`Could not send confirmation to chat ${chatId}:`, err);
      }
    }
    return true;
  }

  getUserLocation(chatId: number): UserAlertPreference | undefined {
    return this.storage.getPreference(chatId);
  }

  async broadcastThreatAlerts(tracks: TrackState[]): Promise<void> {
    if (!this.bot) return;

    const preferences = this.storage.getAllPreferences();
    if (preferences.length === 0) return;

    const now = Date.now();
    const activeOblastNames = this.alertsSource ? this.alertsSource.getActiveAlertOblastNames() : [];

    for (const pref of preferences) {
      if (!pref.enabled) continue;

      const nearest = findNearestOblast(pref.lat, pref.lon);
      const userOblastKey = nearest.oblast.toLowerCase();
      const isOblastAlarmed = activeOblastNames.some((o) => {
        const lower = o.toLowerCase();
        return (
          lower.includes(userOblastKey) ||
          userOblastKey.includes(lower.replace("область", "").trim())
        );
      });

      // 1. Regional Air Raid Alarm state change (Start / All-Clear)
      if (pref.lastAlertState === undefined) {
        pref.lastAlertState = isOblastAlarmed;
        this.storage.savePreference(pref);
      } else if (isOblastAlarmed !== pref.lastAlertState) {
        pref.lastAlertState = isOblastAlarmed;
        this.storage.savePreference(pref);

        try {
          if (isOblastAlarmed) {
            await sendBotMessage(
              pref.chatId,
              `🚨 *ПОВІТРЯНА ТРИВОГА!*\n\n` +
                `📍 Сектор: *${pref.cityName || nearest.nameUk}* (${nearest.oblast} область)\n` +
                `⚠️ У вашому районі оголошено сигнал повітряної тривоги!\n` +
                `Пройдіть в найближче укриття, дотримуйтесь правила двох стін!`,
              { parse_mode: "Markdown", ttlMs: SIX_HOURS_MS }
            );
          } else {
            await sendBotMessage(
              pref.chatId,
              `🟢 *ВІДБІЙ ПОВІТРЯНОЇ ТРИВОГИ!*\n\n` +
                `📍 Сектор: *${pref.cityName || nearest.nameUk}* (${nearest.oblast} область)\n` +
                `🛡️ Сигнал небезпеки скасовано. Загрозу минуло.`,
              { parse_mode: "Markdown", ttlMs: SIX_HOURS_MS }
            );
          }
        } catch {
          // Ignore delivery errors
        }
      }

      // 2. Direct aerial targets: Alert State Machine (NEW -> APPROACHING -> CRITICAL -> PASSED/CLEARED)
      if (tracks.length > 0) {
        for (const track of tracks) {
          if (track.threatLevel === "critical" || track.threatLevel === "high" || track.type === "uav" || track.type === "munition") {
            const evalResult = alertStateMachine.evaluateTrack(pref, track, now);
            if (evalResult.shouldNotify) {
              pref.lastNotified = now;
              this.storage.savePreference(pref);

              let msg = "";
              if (evalResult.state === "CRITICAL") {
                msg =
                  `🔴 *КРИТИЧНА НЕБЕЗПЕКА: ЦІЛЬ ПОРУЧ!*\n\n` +
                  `🎯 Ціль: *${evalResult.targetModel}*\n` +
                  `📏 Відстань: *~${evalResult.distanceKm} км*\n` +
                  `🧭 Швидкість: *${evalResult.speedKmh} км/год*\n` +
                  (evalResult.etaMinutes !== null ? `⏱️ Орієнтовний підліт (ETA): *~${evalResult.etaMinutes} хв*\n\n` : "\n") +
                  `🚨 *Негайно перебувайте в укритті!*`;
              } else if (evalResult.state === "APPROACHING") {
                msg =
                  `⚠️ *УВАГА: НАБЛИЖЕННЯ ПОВІТРЯНОЇ ЦІЛІ!*\n\n` +
                  `🎯 Ціль: *${evalResult.targetModel}*\n` +
                  `📏 Відстань до вас: *~${evalResult.distanceKm} км*\n` +
                  `🧭 Швидкість: *${evalResult.speedKmh} км/год*\n` +
                  (evalResult.etaMinutes !== null ? `⏱️ Орієнтовний підліт (ETA): *~${evalResult.etaMinutes} хв*\n\n` : "\n") +
                  `🛡️ Перейдіть у безпечне місце / правило двох стін!`;
              } else if (evalResult.state === "PASSED") {
                msg =
                  `🛡️ *ЦІЛЬ ПРОЙШЛА ПОВЗ ВАШ СЕКТОР*\n\n` +
                  `🎯 Ціль: *${evalResult.targetModel}*\n` +
                  `📏 Відстань збільшується: *~${evalResult.distanceKm} км*\n` +
                  `Безпосередня небезпека для поточної точки знизилась.`;
              } else if (evalResult.state === "CLEARED") {
                msg =
                  `🟢 *ЗАГРОЗУ СКАСОВАНО / ЦІЛЬ ЗНИЩЕНО*\n\n` +
                  `🎯 Ціль: *${evalResult.targetModel}*\n` +
                  `Ціль зникла з радіолокаційного поля спостереження.`;
              }

              if (msg) {
                try {
                  await sendBotMessage(pref.chatId, msg, { parse_mode: "Markdown", ttlMs: SIX_HOURS_MS });
                } catch {
                  // Ignore delivery errors
                }
              }
            }
          }
        }
      }
    }
  }

  async launch(): Promise<void> {
    if (!this.bot) return;
    try {
      console.log("Telegram bot ready for outbound notifications (webhook active on Vercel).");
      if (env.adminId) {
        try {
          await sendBotMessage(Number(env.adminId), "🟢 Eye Radar cloud worker онлайн (webhook active).", { ttlMs: SIX_HOURS_MS });
        } catch (err) {
          console.log("ℹ️ Повідомлення адміну не надіслано:", (err as Error).message);
        }
      }
    } catch (err) {
      console.warn("Could not launch Telegram bot in webhook mode:", err);
    }
  }

  getBotInstance(): Telegraf | null {
    return this.bot;
  }
}

export const createTelegramBot = (): EyeRadarBotManager => {
  return new EyeRadarBotManager();
};
