import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { createTelegramBot } from "./bot/telegramBot.js";
import { env } from "./config/env.js";
import { TrackManager } from "./core/trackManager.js";
import type { Observation } from "./domain/types.js";
import { parseOsintText } from "./ingest/osintParser.js";
import { normalizeSdrPayload, type SdrPayload } from "./ingest/sdrGateway.js";
import { AlertsInUaSource } from "./sources/alertsInUa.js";
import { FirmsThermalSource } from "./sources/firmsThermal.js";
import { OpenMeteoWindSource } from "./sources/openMeteoWind.js";
import { AirspaceSimulator } from "./sources/simulator.js";
import { RadarHub } from "./ws/hub.js";

const DIST_CLIENT = resolve(process.cwd(), "dist/client");
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg"
};

const trackManager = new TrackManager();
const alertsSource = new AlertsInUaSource();
const firmsSource = new FirmsThermalSource();
const windSource = new OpenMeteoWindSource();
const simulator = new AirspaceSimulator();
let simulationEnabled = true;

const readBody = async (req: IncomingMessage): Promise<string> =>
  new Promise((resolveBody, rejectBody) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        rejectBody(new Error("Body too large"));
      }
    });
    req.on("end", () => resolveBody(raw));
    req.on("error", rejectBody);
  });

const json = (res: ServerResponse, statusCode: number, payload: unknown): void => {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
};

const notFound = (res: ServerResponse): void => {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
};

const ingestBatch = (observations: Observation[], hub: RadarHub): void => {
  for (const observation of observations) {
    trackManager.ingest(observation);
  }
  trackManager.prune();
  hub.broadcastTracks(trackManager.toPackets());
};

const getIpAddress = (req: IncomingMessage): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "";
};

const resolveIpLocation = async (ip: string): Promise<Record<string, unknown> | null> => {
  if (!ip || ip.includes("127.0.0.1") || ip === "::1") {
    return null;
  }

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as Record<string, unknown>;
    return data.success === false ? null : data;
  } catch {
    return null;
  }
};

const serveClient = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? "/", env.publicBaseUrl);
  let pathname = url.pathname;

  if (pathname === "/" || pathname === env.webAppPath || pathname.startsWith(`${env.webAppPath}/`)) {
    pathname = pathname.replace(env.webAppPath, "");
    if (!pathname || pathname === "/") {
      pathname = "index.html";
    }
  }

  const cleanPath = pathname.replace(/^\//, "");
  const filePath = join(DIST_CLIENT, cleanPath);
  const fallback = join(DIST_CLIENT, "index.html");

  const finalPath = existsSync(filePath) ? filePath : fallback;
  if (!existsSync(finalPath)) {
    notFound(res);
    return;
  }

  const contentType = MIME_TYPES[extname(finalPath)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(finalPath).pipe(res);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", env.publicBaseUrl);

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      uptime: process.uptime(),
      tracks: trackManager.snapshot().length,
      simulator: simulationEnabled
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    json(res, 200, {
      wsUrl: `${env.publicBaseUrl.replace(/^http/, "ws")}${env.wsPath}`,
      mapStyleUrl: env.mapStyleUrl
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/alerts") {
    const alerts = await alertsSource.fetchAlerts();
    json(res, 200, { alerts, count: alerts.length });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/wind") {
    const wind = await windSource.fetchWind();
    json(res, 200, { wind });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/location/ip") {
    const ip = getIpAddress(req);
    const resolved = await resolveIpLocation(ip);
    json(res, 200, {
      ip,
      fallback: resolved
        ? {
            lat: resolved.latitude,
            lon: resolved.longitude,
            city: resolved.city,
            country: resolved.country
          }
        : null
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ingest/osint") {
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw) as { text?: string; observations?: Observation[] };
      const observations = parsed.text ? parseOsintText(parsed.text) : parsed.observations ?? [];
      ingestBatch(observations, hub);
      json(res, 200, { accepted: observations.length });
    } catch (e) {
      json(res, 400, { error: "Invalid JSON or payload" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ingest/sdr") {
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw) as { observations: SdrPayload[] };
      const observations = (parsed.observations ?? []).map(normalizeSdrPayload);
      ingestBatch(observations, hub);
      json(res, 200, { accepted: observations.length });
    } catch (e) {
      json(res, 400, { error: "Invalid SDR payload" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/simulator/toggle") {
    simulationEnabled = !simulationEnabled;
    json(res, 200, { simulationEnabled });
    return;
  }

  if (
    (req.method === "GET" || req.method === "HEAD") &&
    (url.pathname === "/" || url.pathname.startsWith(env.webAppPath) || url.pathname.startsWith("/assets"))
  ) {
    await serveClient(req, res);
    return;
  }

  notFound(res);
});

const wss = new WebSocketServer({ noServer: true });
const hub = new RadarHub(wss);
const botManager = createTelegramBot();

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", env.publicBaseUrl);
  if (url.pathname !== env.wsPath) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
    ws.send(JSON.stringify([0, Date.now(), trackManager.toPackets()]));
  });
});

// Periodic main loop: 1 Hz tick for smooth predictive tracking & sensor ingestion
setInterval(async () => {
  const now = Date.now();

  if (simulationEnabled) {
    const simObservations = simulator.generateStep(now);
    for (const obs of simObservations) {
      trackManager.ingest(obs);
    }
  }

  trackManager.tick(now);
  trackManager.prune(now);

  const packets = trackManager.toPackets();
  hub.broadcastTracks(packets);

  // Broadcast personal threat alerts to bot subscribers
  void botManager.broadcastThreatAlerts(trackManager.snapshot());
}, 1_000).unref();

const main = async (): Promise<void> => {
  server.listen(env.port, env.host, async () => {
    console.log(`📡 Eye Radar HTTP/WS listening on http://${env.host}:${env.port}`);
  });

  if (existsSync(join(DIST_CLIENT, "index.html"))) {
    await readFile(join(DIST_CLIENT, "index.html"), "utf8");
  }

  await botManager.launch();
};

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
