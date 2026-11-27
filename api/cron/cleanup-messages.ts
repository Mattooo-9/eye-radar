// api/cron/cleanup-messages.ts
export default async function handler(_req: any, res: any) {
  try {
    const [{ messageDeletionService }, { lifecycleCleanupService }] = await Promise.all([
      import("../../src/server/bot/messageDeletionService.js"),
      import("../../src/server/core/lifecyclePolicy.js")
    ]);
    const [result, lifecycle] = await Promise.all([
      messageDeletionService.processPendingDeletions(),
      lifecycleCleanupService.runCleanupSweep()
    ]);
    let backendHealthy = false;
    try {
      const healthRes = await fetch("https://eye-radar.onrender.com/health", {
        signal: AbortSignal.timeout(8000)
      });
      backendHealthy = healthRes.ok;
    } catch {}
    const payload = {
      ok: true,
      deleted: result.deleted,
      errors: result.errors,
      lifecycle,
      backendHealthy,
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
