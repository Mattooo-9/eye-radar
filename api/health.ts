import type { IncomingMessage, ServerResponse } from "node:http";

export default function handler(
  _req: IncomingMessage,
  res: ServerResponse & { status?: (code: number) => { json: (data: unknown) => void }; json?: (data: unknown) => void }
) {
  if (typeof res.status === "function") {
    res.status(200).json({
      ok: true,
      service: "eye-radar-vercel",
      timestamp: Date.now()
    });
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "eye-radar-vercel", timestamp: Date.now() }));
  }
}
