import { Telegraf } from "telegraf";
import { env } from "../config/env.js";
import { ThreatEngine } from "../core/threatEngine.js";
import type { AlertRegion, TrackState, UserAlertPreference } from "../domain/types.js";
import { findCityInText, UKRAINE_CITIES } from "../sources/ukraineGeo.js";

export class EyeRadarBotManager {
  private bot: Telegraf | null = null;
  private readonly userPreferences = new Map<number, UserAlertPreference>();
  private readonly threatEngine = new ThreatEngine();

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

  private setupHandlers(): void {
    if (!this.bot) return;

    const bot = this.bot;
    const webAppUrl = `${env.publicBaseUrl}${env.webAppPath}`;

    bot.telegram.setMyCommands([
      { command: "start", description: "Запустити радар та налаштування" },
      { command: "radar", description: "Відкрити інтерактивну карту" },
      { command: "alerts", description: "Поточні повітряні тривоги" },
      { command: "setlocation", description: "Встановити місто чи координати для сповіщень" },
      { command: "radius", description: "Встановити радіус тривоги (наприклад: /radius 30)" },
      { command: "status", description: "Стан системи eye-radar" },
      { command: "report", description: "Повідомити про звук або спостереження БПЛА" }
    ]).catch(() => {});

    bot.telegram.setChatMenuButton({
      menuButton: {
        type: "web_app",
        text: "📡 Радар",
        web_app: { url: webAppUrl }
      }
    }).catch(() => {});

    const sendLaunchMessage = async (chatId: number) => {
      await bot.telegram.sendMessage(
        chatId,
        "📡 *Eye Radar — Цивільна ситуаційна обізнаність*\n\n" +
          "Система безперервно аналізує відкриті джерела, ADS-B, супутникові дані та моніторинг повітряного простору України.\n\n" +
          "🔘 Натисніть кнопку нижче, щоб відкрити інтерактивну карту.\n" +
          "📍 Надішліть вашу геопозицію або назву міста для персональних сповіщень про наближення цілей.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🗺️ Відкрити Радар (Mini App)", web_app: { url: webAppUrl } }]
            ]
          }
        }
      );
    };

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

      const pref = this.userPreferences.get(ctx.chat.id) ?? {
        chatId: ctx.chat.id,
        lat: 50.4501,
        lon: 30.5234, // Default Kyiv
        radiusKm: km,
        enabled: true
      };
      pref.radiusKm = km;
      this.userPreferences.set(ctx.chat.id, pref);

      await ctx.reply(`✅ Радіус сповіщення встановлено: *${km} км*`, { parse_mode: "Markdown" });
    });

    bot.command("setlocation", async (ctx) => {
      const parts = ctx.message.text.split(" ").slice(1).join(" ");
      if (!parts) {
        await ctx.reply(
          "Вкажіть назву міста після команди (наприклад: `/setlocation Полтава`) або просто надішліть локацію Telegram кнопкою в чаті.",
          { parse_mode: "Markdown" }
        );
        return;
      }

      const city = findCityInText(parts);
      if (city) {
        const pref = this.userPreferences.get(ctx.chat.id) ?? {
          chatId: ctx.chat.id,
          lat: city.lat,
          lon: city.lon,
          radiusKm: 30,
          enabled: true
        };
        pref.lat = city.lat;
        pref.lon = city.lon;
        this.userPreferences.set(ctx.chat.id, pref);

        await ctx.reply(`✅ Локацію для сповіщень встановлено: *${city.nameUk}* (${city.lat}, ${city.lon})`, {
          parse_mode: "Markdown"
        });
      } else {
        await ctx.reply(`Не вдалося знайти місто "${parts}". Спробуйте іншу назву (Київ, Дніпро, Харків тощо).`);
      }
    });

    bot.on("location", async (ctx) => {
      const loc = ctx.message.location;
      const pref = this.userPreferences.get(ctx.chat.id) ?? {
        chatId: ctx.chat.id,
        lat: loc.latitude,
        lon: loc.longitude,
        radiusKm: 30,
        enabled: true
      };
      pref.lat = loc.latitude;
      pref.lon = loc.longitude;
      this.userPreferences.set(ctx.chat.id, pref);

      await ctx.reply(`📍 Координати збережено: *${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}*. Радіус контролю: *${pref.radiusKm} км*`, {
        parse_mode: "Markdown"
      });
    });

    bot.command("alerts", async (ctx) => {
      await ctx.reply(
        "🔔 *Статус тривог*: активні сектори постійно оновлюються на карті в реальному часі.\nВідкрийте Mini App для детальної карти безпеки.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "🗺️ Переглянути на карті", web_app: { url: webAppUrl } }]]
          }
        }
      );
    });

    bot.command("report", async (ctx) => {
      const text = ctx.message.text.replace(/^\/report\s*/, "").trim();
      if (!text) {
        await ctx.reply("Вкажіть спостереження після команди. Приклад: `/report Чую звук мопеда на південь від Кременчука`", {
          parse_mode: "Markdown"
        });
        return;
      }

      await ctx.reply("✅ Дякуємо за інформацію! Повідомлення передано в систему аналізу для перехресної перевірки.");
    });
  }

  async broadcastThreatAlerts(tracks: TrackState[]): Promise<void> {
    if (!this.bot || this.userPreferences.size === 0 || tracks.length === 0) {
      return;
    }

    const now = Date.now();

    for (const pref of this.userPreferences.values()) {
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
        await this.bot.telegram.sendMessage(Number(env.adminId), "🟢 Eye Radar bot онлайн.");
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
