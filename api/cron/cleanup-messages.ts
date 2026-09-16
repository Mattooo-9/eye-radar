// api/cron/cleanup-messages.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { messageDeletionService } from "../../src/server/bot/messageDeletionService.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const result = await messageDeletionService.processPendingDeletions();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      deleted: result.deleted,
      errors: result.errors,
      timestamp: Date.now()
    }));
  } catch (err: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: false,
      error: err?.message || String(err)
    }));
  }
}
