import { env } from "../config/env.js";
import type { TrackState } from "../domain/types.js";

export interface AirspaceSummaryRequest {
  tracks: TrackState[];
  userCity?: string;
  userCoords?: { lat: number; lon: number };
}

export class AiBriefingService {
  async generateBriefing(request: AirspaceSummaryRequest): Promise<string> {
    const { tracks, userCity, userCoords } = request;

    const uavs = tracks.filter((t) => t.objectType === "uav_shahed" || t.objectType === "uav_recon");
    const missiles = tracks.filter((t) => t.objectType === "missile_cruise" || t.objectType === "missile_ballistic");
    const total = tracks.length;

    // Fallback template if no AI key configured or network fails
    const defaultSummary = (): string => {
      const parts: string[] = [
        `📊 *Оперативна оцінка повітряної обстановки (Eye Radar)*\n`,
        `🎯 Зафіксовано активних цілей: *${total}*`,
        `• БПЛА (Shahed/Розвідувальні): *${uavs.length}*`,
        `• Ракети (крилаті/балістичні): *${missiles.length}*`
      ];

      if (userCity) {
        parts.push(`\n📍 Ваша зона моніторингу: *${userCity}*`);
      }

      if (missiles.length > 0) {
        parts.push(`\n⚠️ *Підвищена небезпека:* Зафіксовано швидкісні ракетні цілі. Дотримуйтесь правила "двох стін" або перебувайте в укриттях.`);
      } else if (uavs.length > 0) {
        parts.push(`\n⚠️ *Увага:* Рух ударних БПЛА. Не ігноруйте сигнали тривоги та тримайтеся подалі від вікон.`);
      } else {
        parts.push(`\n🟢 У вашому секторі прямої загрози не зафіксовано. Моніторинг триває безперервно.`);
      }

      return parts.join("\n");
    };

    const apiKey = env.openrouterApiKey || env.groqApiKey || env.openaiApiKey;
    if (!apiKey) {
      return defaultSummary();
    }

    const trackDetails = tracks
      .slice(0, 10)
      .map(
        (t, i) =>
          `Ціль ${i + 1}: тип ${t.objectType}, швидкість ${Math.round(t.velocityKmh)} км/год, курс ${Math.round(t.headingDeg)}°, координати (${t.lat.toFixed(2)}, ${t.lon.toFixed(2)}), впевненість ${Math.round(t.confidenceScore)}%`
      )
      .join("\n");

    const systemPrompt =
      "Ти — тактичний аналітик цивільної безпеки системи Eye Radar України. Твоє завдання — на основі телеметрії радіолокаційних треків надати чітке, стисле, спокійне та корисне оперативне зведення для цивільного населення українською мовою. Уникай паніки, виділяй головне: вектори руху, ймовірні напрямки, правила безпеки. Форматуй у Telegram Markdown. Не перевищуй 150 слів.";

    const userPrompt = `Поточна ситуація:\nУсього треків: ${total} (БПЛА: ${uavs.length}, Ракет: ${missiles.length})\n${trackDetails}\n${
      userCity ? `Користувач знаходиться біля: ${userCity}` : ""
    }\nСклади стисле оперативне зведення з рекомендаціями для цивільних.`;

    try {
      const endpoint = env.openrouterApiKey
        ? "https://openrouter.ai/api/v1/chat/completions"
        : env.groqApiKey
        ? "https://api.groq.com/openai/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";

      const model = env.openrouterApiKey
        ? "meta-llama/llama-3.3-70b-instruct:free"
        : env.groqApiKey
        ? "qwen/qwen3.6-27b"
        : "gpt-4o-mini";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://eye-radar.ua",
          "X-Title": "Eye-Radar"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 350,
          temperature: 0.3
        }),
        signal: AbortSignal.timeout(6000)
      });

      if (!response.ok) {
        return defaultSummary();
      }

      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const reply = data.choices?.[0]?.message?.content?.trim();
      return reply || defaultSummary();
    } catch {
      return defaultSummary();
    }
  }
}
