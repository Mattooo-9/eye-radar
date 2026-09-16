// api/telegram/webhook.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { messageDeletionService } from "../../src/server/bot/messageDeletionService.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "Eye Radar Telegram Webhook ready" }));
    return;
  }

  let body = "";
  req.setEncoding("utf8");
  req.on("data", chunk => { body += chunk; });
  req.on("end", async () => {
    try {
      const update = JSON.parse(body);
      // Process incoming message or callback
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    }
  });
}
