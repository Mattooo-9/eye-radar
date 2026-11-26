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

    const osintReports = tracks.filter((t) => t.dataCategory === "osint_message" || t.evidenceFamilies?.includes("osint"));
    const sensorTracks = tracks.filter((t) => t.dataCategory !== "osint_message" && !t.evidenceFamilies?.includes("osint"));
    const uavs = tracks.filter((t) => t.type === "uav");
    const missiles = tracks.filter((t) => t.type === "munition");
    const bombs = tracks.filter((t) => t.type === "bomb");
    const total = tracks.length;

    // Fallback template if no AI key configured or network fails
    const defaultSummary = (): string => {
      const parts: string[] = [
        `📊 *Оперативне зведення повітряної обстановки (Eye Radar)*\n`,
        `• Загалом активних записів: *${total}*`,
        `• Текстові повідомлення ППО (OSINT): *${osintReports.length}* (БПЛА: ${uavs.length}, Ракети: ${missiles.length}, КАБ: ${bombs.length})`,
        `• Фактичні спостереження сенсорів (ADS-B): *${sensorTracks.length}*`
      ];

      if (userCity) {
        parts.push(`\n📍 Зона моніторингу: *${userCity}*`);
      }

      if (missiles.length > 0 || bombs.length > 0) {
        parts.push(`\n⚠️ *Підвищена небезпека:* У зведеннях ППО є ракетні / авіабомбові загрози. Перебувайте в укритті до офіційного відбою тривоги.`);
      } else if (uavs.length > 0) {
        parts.push(`\n⚠️ *Увага:* У зведеннях ППО зафіксовано рух БПЛА. Слідкуйте за офіційними сигналами тривоги та тримайтесь подалі від вікон.`);
      } else {
        parts.push(`\n🟢 Активних повітряних загроз у зведеннях зараз не зафіксовано. Слідкуйте за офіційними сповіщеннями.`);
      }

      return parts.join("\n");
    };

    const apiKey = env.openrouterApiKey || env.groqApiKey || env.openaiApiKey;
    if (!apiKey) {
      return defaultSummary();
    }

    const trackDetails = tracks
      .slice(0, 10)
      .map((t, i) => {
        const cat = t.dataCategory === "osint_message" ? "текстове повідомлення OSINT" : "сенсор ADS-B";
        const spd = t.measuredSpeed !== undefined ? `${Math.round(t.measuredSpeed * 3.6)} км/год` : "швидкість невідома";
        const alt = t.measuredAltitude !== undefined ? `${Math.round(t.measuredAltitude)} м` : "висота невідома";
        const hdg = t.measuredHeading !== undefined ? `курс ${Math.round(t.measuredHeading)}°` : "курс невідомий";
        return `Запис ${i + 1} [${cat}]: ${t.model || t.type}, ${spd}, ${alt}, ${hdg}, район (${t.lat.toFixed(2)}, ${t.lon.toFixed(2)})`;
      })
      .join("\n");

    const systemPrompt =
      "Ти — аналітик цивільного інформування Eye Radar України. На основі фактичних даних (строго розділяючи текстові повідомлення ППО та спостереження ADS-B) дай коротке, спокійне зведення українською мовою. НЕ вигадуй висоту, швидкість, аеродроми чи підрозділи, якщо їх немає у вхідних даних. До 140 слів.";

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
