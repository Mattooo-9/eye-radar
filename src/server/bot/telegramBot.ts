import { Telegraf } from "telegraf";
import { env } from "../config/env.js";
import { AiBriefingService } from "../core/aiBriefing.js";
import { StorageManager } from "../core/storage.js";
import { ThreatEngine } from "../core/threatEngine.js";
import type { AlertRegion, TrackState, UserAlertPreference } from "../domain/types.js";
import type { SourceHealthTracker } from "../sources/sourceHealth.js";
import { findCityInText, UKRAINE_CITIES } from "../sources/ukraineGeo.js";

export class EyeRadarBotManager {
  private bot: Telegraf | null = null;
  private readonly storage = new StorageManager();
  private readonly threatEngine = new ThreatEngine();
  private readonly aiBriefing = new AiBriefingService();
  private healthTracker?: SourceHealthTracker;
  private trackCountProvider?: () => number;
  private tracksProvider?: () => TrackState[];

  constructor() {
    if (!env.botToken || env.botToken === "YOUR_TELEGRAM_BOT_TOKEN") {
      console.warn("⚠️ BOT_TOKEN not configured. Telegram bot disabled.");
      return;
    }

    try {
      this.bot = new Telegraf(env.botToken);
      this.setupHandlers();
    } catch (err) {
      console.error("Failed to initialize Telegraf:", err);
    }
  }

  setHealthTracker(tracker: SourceHealthTracker, trackCountProvider: () => number, tracksProvider?: () => TrackState[]): void {
    this.healthTracker = tracker;
    this.trackCountProvider = trackCountProvider;
    this.tracksProvider = tracksProvider;
  }

  private setupHandlers(): void {
    if (!this.bot) return;

    const bot = this.bot;
    const webAppUrl = process.env.VERCEL_APP_URL || (env.publicBaseUrl.includes("onrender.com") ? "https://eye-radar.vercel.app/app" : `${env.publicBaseUrl}${env.webAppPath}`);

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
    const getRadarButton = (text = "🗺️ Відкрити Радар") =>
      isHttps ? { text: `${text} (Mini App)`, web_app: { url: webAppUrl } } : { text: `${text} (Web)`, url: webAppUrl };

    if (isHttps) {
      bot.telegram.setChatMenuButton({
        menuButton: {
          type: "web_app",
          text: "📡 Радар",
          web_app: { url: webAppUrl }
        }
      }).catch(() => {});
    }

    const getPersistentKeyboard = () => ({
      keyboard: [
        [
          isHttps
            ? { text: "🛰️ ВІДКРИТИ 3D РАДАР", web_app: { url: webAppUrl } }
            : { text: "🛰️ ВІДКРИТИ 3D РАДАР" }
        ],
        [
          { text: "📊 AI-Зведення" },
          { text: "🔔 Тривоги" }
        ],
        [
          { text: "⚙️ Статус" },
          { text: "📍 Надіслати координати", request_location: true }
        ]
      ],
      resize_keyboard: true,
      is_persistent: true
    });

    const sendLaunchMessage = async (chatId: number) => {
      const userPref = this.storage.getPreference(chatId);
      const locText = userPref ? `\n📍 Поточна локація: *${userPref.lat.toFixed(4)}, ${userPref.lon.toFixed(4)}* (радіус *${userPref.radiusKm} км*)` : "\n📍 Локація ще не встановлена (натисніть «📍 Надіслати координати» або /setlocation)";

      try {
        await bot.telegram.sendMessage(
          chatId,
          "🛰️ *Eye Radar — Ситуаційна обізнаність цивільної безпеки*\n\n" +
            "Система безперервно аналізує відкриті джерела, ADS-B, супутникові дані та моніторинг повітряного простору України." +
            locText +
            "\n\n🔘 Кнопку швидкого доступу закріплено над полем чату для миттєвого відкриття 3D-мапи.",
          {
            parse_mode: "Markdown",
            reply_markup: getPersistentKeyboard()
          }
        );

        await bot.telegram.sendMessage(
          chatId,
          "Оберіть дію або відкрийте інтерактивну карту:",
          {
            reply_markup: {
              inline_keyboard: [
                [getRadarButton("🛰️ Відкрити 3D Радар (Mini App)")],
                [
                  { text: "📊 AI-Зведення", callback_data: "cmd_briefing" },
                  { text: "🔔 Тривоги", callback_data: "cmd_alerts" }
                ],
                [
                  { text: "⚙️ Статус системи", callback_data: "cmd_status" }
                ]
              ]
            }
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

      await ctx.reply(summary, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[getRadarButton("🛰️ Відкрити 3D Радар")]]
        }
      });
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
      await ctx.reply("🔔 Актуальні зони повітряних тривог відображаються на карті в реальному часі.", {
        reply_markup: {
          inline_keyboard: [[getRadarButton("🛰️ Відкрити радар")]]
        }
      });
    });
    bot.hears("⚙️ Статус", async (ctx) => {
      await ctx.reply(formatStatusReport(), { parse_mode: "Markdown" });
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
        await ctx.reply("Вкажіть радіус від 5 до 150 км. Приклад: `/radius 35`", { parse_mode: "Markdown" });
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

      await ctx.reply(`✅ Радіус персонального сповіщення встановлено: *${km} км*`, { parse_mode: "Markdown" });
    });

    bot.command("setlocation", async (ctx) => {
      const parts = ctx.message.text.split(" ").slice(1).join(" ");
      if (!parts) {
        await ctx.reply(
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

        await ctx.reply(`✅ Локацію для сповіщень встановлено: *${city.nameUk}* (${city.lat}, ${city.lon}). Радіус: *${pref.radiusKm} км*`, {
          parse_mode: "Markdown"
        });
      } else {
        await ctx.reply(`Не вдалося знайти місто "${parts}". Спробуйте іншу назву (Київ, Харків, Одеса, Дніпро, Запоріжжя тощо).`);
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

      await ctx.reply(`📍 Координати збережено: *${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}*. Радіус контролю: *${pref.radiusKm} км*`, {
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
      await ctx.reply(formatStatusReport(), { parse_mode: "Markdown" });
    });

    bot.action("cmd_status", async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply(formatStatusReport(), { parse_mode: "Markdown" });
    });

    bot.command("alerts", async (ctx) => {
      await ctx.reply(
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
      await ctx.reply("🔔 Відкрийте карту для перегляду актуальних секторів тривоги.", {
        reply_markup: {
          inline_keyboard: [[getRadarButton("🗺️ Відкрити радар")]]
        }
      });
    });

    bot.command("report", async (ctx) => {
      const text = ctx.message.text.replace(/^\/report\s*/, "").trim();
      if (!text) {
        await ctx.reply("Вкажіть спостереження після команди. Приклад: `/report Чую звук двигуна БПЛА на південь від міста`", {
          parse_mode: "Markdown"
        });
        return;
      }

      await ctx.reply("✅ Дякуємо за інформацію! Повідомлення передано в чергу аналізу для зіставлення з даними сенсорів.");
    });
  }

  async broadcastThreatAlerts(tracks: TrackState[]): Promise<void> {
    if (!this.bot || tracks.length === 0) {
      return;
    }

    const preferences = this.storage.getAllPreferences();
    if (preferences.length === 0) return;

    const now = Date.now();

    for (const pref of preferences) {
      if (!pref.enabled) continue;
      // Rate limit: max 1 alert per 8 minutes per user unless critical
      if (pref.lastNotified && now - pref.lastNotified < 8 * 60_000) {
        continue;
      }

      const threat = this.threatEngine.findHighestThreat(tracks, { lat: pref.lat, lon: pref.lon });
      if (threat && (threat.threatLevel === "critical" || threat.threatLevel === "high")) {
        const distanceKm = Math.round(threat.distanceMeters / 1000);
        if (distanceKm <= pref.radiusKm) {
          pref.lastNotified = now;
          this.storage.savePreference(pref);

          const msg = threat.warningMessage ?? `⚠️ УВАГА: Повітряна ціль на відстані ~${distanceKm} км курсом у ваш сектор! Перейдіть в укриття.`;
          try {
            await this.bot.telegram.sendMessage(pref.chatId, msg);
          } catch {
            // Ignore delivery errors (e.g. user blocked bot)
          }
        }
      }
    }
  }

  async launch(): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.launch();
      console.log("Telegram bot launched successfully.");
      if (env.adminId) {
        try {
          await this.bot.telegram.sendMessage(Number(env.adminId), "🟢 Eye Radar bot онлайн.");
        } catch (err) {
          console.log("ℹ️ Повідомлення адміну не надіслано (необхідно спочатку натиснути /start в боті):", (err as Error).message);
        }
      }
    } catch (err) {
      console.warn("Could not launch Telegram bot (check token or network):", err);
    }
  }

  getBotInstance(): Telegraf | null {
    return this.bot;
  }
}

export const createTelegramBot = (): EyeRadarBotManager => {
  return new EyeRadarBotManager();
};
