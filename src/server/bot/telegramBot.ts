import { Telegraf } from "telegraf";
import { env } from "../config/env.js";
import { AiBriefingService } from "../core/aiBriefing.js";
import { StorageManager } from "../core/storage.js";
import { ThreatEngine } from "../core/threatEngine.js";
import type { AlertRegion, TrackState, UserAlertPreference } from "../domain/types.js";
import type { AlertsInUaSource } from "../sources/alertsInUa.js";
import type { SourceHealthTracker } from "../sources/sourceHealth.js";
import { findCityInText, UKRAINE_CITIES } from "../sources/ukraineGeo.js";

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
        // Clear any old bulky custom reply keyboard if present from previous sessions
        try {
          const rm = await bot.telegram.sendMessage(chatId, "🛰️", {
            reply_markup: { remove_keyboard: true }
          });
          await bot.telegram.deleteMessage(chatId, rm.message_id);
        } catch {}

        const primaryBtn = isHttps
          ? { text: "🛰️ ВІДКРИТИ EYE RADAR", web_app: { url: webAppUrl } }
          : { text: "🛰️ ВІДКРИТИ EYE RADAR", url: webAppUrl };

        await bot.telegram.sendMessage(
          chatId,
          "🛰️ *EYE RADAR // ТАКТИЧНА СИСТЕМА МОНІТОРИНГУ*\n\n" +
            "• Живі повітряні цілі: Шахеди, ракети, бойова авіація\n" +
            "• Зони тривог, супутникові термоточки та метеодані\n" +
            "• Оперативне AI-зведення, анти-спуфінг та акустичний моніторинг\n\n" +
            "_Усі модулі, статус та налаштування перенесені в інтерактивне мінідодаток._",
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [primaryBtn]
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

    if (this.bot) {
      try {
        await this.bot.telegram.sendMessage(
          chatId,
          `📍 *Локацію для сповіщень підтверджено!*\n\n` +
            `🎯 Сектор: *${resolvedCity}* (${nearest.oblast} обл.)\n` +
            `🌐 Координати: \`${lat.toFixed(4)}, ${lon.toFixed(4)}\`\n` +
            `📏 Радіус контролю: *${radiusKm} км*\n\n` +
            `🔔 *Ви отримуватимете в цьому боті:*\n` +
            `• Сигнали початку та відбою повітряної тривоги для вашого сектору\n` +
            `• Попередження про пряме наближення Шахедів, ракет та КАБів у радіус ${radiusKm} км\n\n` +
            `_Змінити локацію можна кліком на карті або командою /setlocation_`,
          { parse_mode: "Markdown" }
        );
        return true;
      } catch (err) {
        console.warn(`Could not send confirmation to chat ${chatId}:`, err);
      }
    }
    return true;
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
            await this.bot.telegram.sendMessage(
              pref.chatId,
              `🚨 *ПОВІТРЯНА ТРИВОГА!*\n\n` +
                `📍 Сектор: *${pref.cityName || nearest.nameUk}* (${nearest.oblast} область)\n` +
                `⚠️ У вашому районі оголошено сигнал повітряної тривоги!\n` +
                `Пройдіть в найближче укриття, дотримуйтесь правила двох стін!`,
              { parse_mode: "Markdown" }
            );
          } else {
            await this.bot.telegram.sendMessage(
              pref.chatId,
              `🟢 *ВІДБІЙ ПОВІТРЯНОЇ ТРИВОГИ!*\n\n` +
                `📍 Сектор: *${pref.cityName || nearest.nameUk}* (${nearest.oblast} область)\n` +
                `🛡️ Сигнал небезпеки скасовано. Загрозу минуло.`,
              { parse_mode: "Markdown" }
            );
          }
        } catch {
          // Ignore delivery errors
        }
      }

      // 2. Direct aerial target approaching user's radius (Shahed / missile / KAB / FPV)
      if (tracks.length > 0) {
        // Rate limit threat proximity warning: max 1 per 6 minutes unless critical
        if (pref.lastNotified && now - pref.lastNotified < 6 * 60_000) {
          continue;
        }

        const threat = this.threatEngine.findHighestThreat(tracks, { lat: pref.lat, lon: pref.lon });
        if (threat && (threat.threatLevel === "critical" || threat.threatLevel === "high")) {
          const distanceKm = Math.round(threat.distanceMeters / 1000);
          if (distanceKm <= pref.radiusKm) {
            pref.lastNotified = now;
            this.storage.savePreference(pref);

            const matchedTrack = tracks.find((t) => t.id === threat.trackId);
            const speedKmh = matchedTrack ? Math.round(matchedTrack.speed * 3.6) : undefined;
            const headingDeg = matchedTrack ? Math.round(matchedTrack.heading) : undefined;
            const targetName = matchedTrack?.model || matchedTrack?.type?.toUpperCase() || "ПОВІТРЯНА ЦІЛЬ";
            const etaMin = threat.etaMinutes !== null && threat.etaMinutes !== undefined ? threat.etaMinutes : undefined;

            const msg =
              `⚠️ *УВАГА: НАБЛИЖЕННЯ ПОВІТРЯНОЇ ЦІЛІ!*\n\n` +
              `🎯 Ціль: *${targetName}*\n` +
              `📏 Відстань до вас: *~${distanceKm} км*\n` +
              (speedKmh ? `🧭 Швидкість: *${speedKmh} км/год* | Курс: *${headingDeg}°*\n` : "") +
              (etaMin ? `⏱️ Орієнтовний підліт (ETA): *~${etaMin} хв*\n\n` : "\n") +
              `🚨 *Негайно перебувайте в укритті!*`;

            try {
              await this.bot.telegram.sendMessage(pref.chatId, msg, { parse_mode: "Markdown" });
            } catch {
              // Ignore delivery errors
            }
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
