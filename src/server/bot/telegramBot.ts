import { Telegraf } from "telegraf";
import { env } from "../config/env.js";

export const createTelegramBot = (): Telegraf => {
  const bot = new Telegraf(env.botToken);
  const webAppUrl = `${env.publicBaseUrl}${env.webAppPath}`;

  bot.telegram.setMyCommands([
    { command: "start", description: "Запустить радар" },
    { command: "radar", description: "Открыть Web App" }
  ]);

  bot.telegram.setChatMenuButton({
    menuButton: {
      type: "web_app",
      text: "Открыть радар",
      web_app: { url: webAppUrl }
    }
  });

  const sendLaunchMessage = async (chatId: number): Promise<void> => {
    await bot.telegram.sendMessage(
      chatId,
      "Радар активирован. Открой Web App кнопкой ниже.",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Открыть радар",
                web_app: { url: webAppUrl }
              }
            ]
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

  return bot;
};
