// api/cron/cleanup-messages.ts
export default async function handler(req: any, res: any) {
  try {
    const { messageDeletionService } = await import("../../src/server/bot/messageDeletionService.js");
    const result = await messageDeletionService.processPendingDeletions();
    const payload = {
      ok: true,
      deleted: result.deleted,
      errors: result.errors,
      timestamp: Date.now()
    };
    if (typeof res.status === "function") {
      return res.status(200).json(payload);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  } catch (err: any) {
    const payload = {
      ok: false,
      error: err?.message || String(err)
    };
    if (typeof res.status === "function") {
      return res.status(500).json(payload);
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  }
}
