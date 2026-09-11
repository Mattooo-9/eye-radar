import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { createTelegramBot } from "./bot/telegramBot.js";
import { env } from "./config/env.js";
import { AiBriefingService } from "./core/aiBriefing.js";
import { TrackManager } from "./core/trackManager.ts";
import type { Observation } from "./domain/types.js";
import { parseOsintText } from "./ingest/osintParser.js";
import { normalizeSdrPayload, type SdrPayload } from "./ingest/sdrGateway.js";
import { AirplanesLiveSource } from "./sources/airplanesLive.js";
import { OpenskyAdsbLolSource } from "./sources/openskyAdsbLol.js";
import { LocalReceiverSource } from "./sources/localReceiver.js";
import { PublicOsintFeedSource } from "./sources/publicOsintFeed.js";
import { toObservation } from "./domain/unifiedObservation.js";
import { AlertsInUaSource } from "./sources/alertsInUa.js";
import { FirmsThermalSource } from "./sources/firmsThermal.js";
import { OpenMeteoWindSource } from "./sources/openMeteoWind.js";
import { AirspaceSimulator } from "./sources/simulator.js";
import { SourceHealthTracker } from "./sources/sourceHealth.js";
import { AdsbUnifiedSource } from "./sources/adsbUnifiedSource.js";
import { impactManager } from "./core/impactManager.js";
import { sourceRegistry } from "./sources/SourceRegistry.js";




const DIST_CLIENT = resolve(process.cwd(), "dist/client");
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg"
};

const trackManager = new TrackManager(sourceRegistry);
const alertsSource = new AlertsInUaSource();
const firmsSource = new FirmsThermalSource();
const windSource = new OpenMeteoWindSource();
const airplanesSource = new AirplanesLiveSource();
const openskyLolSource = new OpenskyAdsbLolSource();
const localReceiverSource = new LocalReceiverSource();
const publicOsintSource = new PublicOsintFeedSource();
const simulator = new AirspaceSimulator();
simulator.setAlertsSource(alertsSource);
const healthTracker = new SourceHealthTracker();
// Live Airspace Situational Awareness (Alerts-driven + Tactical baseline)
let simulationEnabled = process.env.SIMULATION_ENABLED !== "false";

sourceRegistry.register(
  "alerts.in.ua",
  "alerts",
  alertsSource,
  {
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceTypes: ["alert"],
  }
);

// Register ADS-B unified source
const adsbUnifiedSource = new AdsbUnifiedSource();
sourceRegistry.register(
  "adsbUnified",
  "adsb",
  adsbUnifiedSource,
  {
    canCreateTrack: true,
    canClassify: false,
    canProvidePosition: true,
    canProvideAltitude: true,
    canProvideSpeed: true,
    evidenceTypes: ["adsb"],
  }
);
sourceRegistry.register(
  "local.sdr",
  "sdr",
  localReceiverSource,
  {
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceTypes: ["sdr"],
  },
  { disabled: true }
);
sourceRegistry.register(
  "public.osint",
  "osint",
  publicOsintSource,
  {
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceTypes: ["osint"],
  }
);
sourceRegistry.register(
  "open-meteo",
  "weather",
  windSource,
  {
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceTypes: ["weather"],
  }
);
sourceRegistry.register(
  "nasa-firms",
  "thermal",
  firmsSource,
  {
    canCreateTrack: true,
    canClassify: true,
    canProvidePosition: true,
    canProvideAltitude: true,
    canProvideSpeed: true,
    evidenceTypes: ["thermal"],
  }
);
sourceRegistry.register(
  "ukraine-alarm",
  "alerts",
  {} as any,
  {
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceTypes: ["alert"],
  }
);
sourceRegistry.register(
  "kyiv-digital",
  "alerts",
  {} as any,
  {
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceTypes: ["alert"],
  }
);

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
  const cacheControl = finalPath.endsWith("index.html")
    ? "no-cache, no-store, must-revalidate, max-age=0"
    : "public, max-age=31536000, immutable";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    ...(finalPath.endsWith("index.html") ? { Pragma: "no-cache", Expires: "0" } : {})
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(finalPath).pipe(res);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", env.publicBaseUrl);

  if (req.method === "GET" && url.pathname === "/health") {
    const audit = healthTracker.getAuditReport(trackManager.snapshot(simulationEnabled));
    json(res, 200, {
      ok: true,
      uptime: process.uptime(),
      tracks: trackManager.snapshot(simulationEnabled).length,
      simulator: simulationEnabled,
      wsClients: hub.getClientCount(),
      summary: audit.summary,
      sources: audit.sources
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/audit") {
    const audit = healthTracker.getAuditReport(trackManager.snapshot(simulationEnabled));
    json(res, 200, audit);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/tracks/") && url.pathname.endsWith("/diagnostic")) {
    const id = url.pathname.replace("/api/tracks/", "").replace("/diagnostic", "");
    const diag = trackManager.getTrackDiagnostic(decodeURIComponent(id));
    if (diag) {
      json(res, 200, diag);
    } else {
      notFound(res);
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    const audit = healthTracker.getAuditReport(trackManager.snapshot(simulationEnabled));
    json(res, 200, {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      tracksCount: trackManager.snapshot(simulationEnabled).length,
      wsClients: hub.getClientCount(),
      sources: audit.sources,
      summary: audit.summary,
      simulationEnabled
    });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/api/tracks" || url.pathname === "/api/targets")) {
    const list = trackManager.snapshot(simulationEnabled);
    if (url.pathname === "/api/targets") {
      json(res, 200, { count: list.length, tracks: list });
    } else {
      json(res, 200, list);
    }
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

  if (req.method === "GET" && url.pathname === "/api/thermal") {
    const thermals = await firmsSource.fetchThermalObservations();
    json(res, 200, { thermals, count: thermals.length });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/briefing") {
    const ai = new AiBriefingService();
    const city = url.searchParams.get("city") || undefined;
    const briefing = await ai.generateBriefing({
      tracks: trackManager.snapshot(),
      userCity: city
    });
    json(res, 200, { briefing });
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

  if (req.method === "POST" && url.pathname === "/api/alerts/subscribe") {
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw) as {
        userId?: string | number;
        lat?: number;
        lon?: number;
        cityName?: string;
        radiusKm?: number;
      };
      const chatId = typeof parsed.userId === "number" ? parsed.userId : parseInt(String(parsed.userId || ""), 10);
      const lat = typeof parsed.lat === "number" && !isNaN(parsed.lat) ? parsed.lat : 50.45;
      const lon = typeof parsed.lon === "number" && !isNaN(parsed.lon) ? parsed.lon : 30.52;
      const radiusKm = typeof parsed.radiusKm === "number" && !isNaN(parsed.radiusKm) ? Math.min(150, Math.max(5, parsed.radiusKm)) : 30;

      if (!isNaN(chatId) && chatId > 0) {
        await botManager.subscribeUserLocation(chatId, lat, lon, parsed.cityName, radiusKm);
        json(res, 200, { ok: true, subscribed: true, chatId, lat, lon, radiusKm });
      } else {
        json(res, 400, { error: "Invalid Telegram user ID or chat ID" });
      }
    } catch {
      json(res, 400, { error: "Invalid payload" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ingest/osint") {
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw) as { text?: string; observations?: Observation[] };
      const observations = parsed.text ? parseOsintText(parsed.text) : parsed.observations ?? [];
      ingestBatch(observations, hub);
      json(res, 200, { accepted: observations.length });
    } catch {
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
    } catch {
      json(res, 400, { error: "Invalid SDR payload" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/report") {
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw) as {
        type?: string;
        lat?: number;
        lon?: number;
        direction?: string;
        comment?: string;
      };

      const lat = typeof parsed.lat === "number" && !isNaN(parsed.lat) ? parsed.lat : 50.45;
      const lon = typeof parsed.lon === "number" && !isNaN(parsed.lon) ? parsed.lon : 30.52;
      const reportType = parsed.type || "uav_sound";

      let headingDeg = 180;
      switch (parsed.direction) {
        case "N": headingDeg = 0; break;
        case "NE": headingDeg = 45; break;
        case "E": headingDeg = 90; break;
        case "SE": headingDeg = 135; break;
        case "S": headingDeg = 180; break;
        case "SW": headingDeg = 225; break;
        case "W": headingDeg = 270; break;
        case "NW": headingDeg = 315; break;
      }

      const isMunition = reportType === "munition_visual";
      const observation: Observation = {
        id: `citizen-${Date.now().toString(36)}`,
        type: isMunition ? "munition" : "uav",
        lat,
        lon,
        heading: headingDeg,
        speed: isMunition ? 220 : 52,
        timestamp: Date.now(),
        source: "manual",
        confidence: 0.88,
        altitude: isMunition ? 120 : 250,
        meta: {
          reportType,
          comment: parsed.comment || "Citizen acoustic report"
        }
      };

      const lowerComment = (parsed.comment || "").toLowerCase();
      const isIntercept =
        reportType.includes("air_defense") ||
        reportType.includes("intercept") ||
        lowerComment.includes("збито") ||
        lowerComment.includes("збили") ||
        lowerComment.includes("ппо") ||
        lowerComment.includes("перехоп") ||
        lowerComment.includes("мінус");

      const isImpact =
        reportType.includes("explosion") ||
        reportType.includes("impact") ||
        lowerComment.includes("вибух") ||
        lowerComment.includes("приліт") ||
        lowerComment.includes("влучання") ||
        lowerComment.includes("детонація") ||
        lowerComment.includes("пожежа");

      if (isIntercept) {
        impactManager.createAndRecord(
          "intercept",
          lat,
          lon,
          isMunition ? "Крилата ракета" : "БПЛА-камікадзе",
          isMunition ? "munition" : "uav",
          "За рапортом очевидця",
          parsed.comment || "Успішне перехоплення мобільною вогневою групою / підрозділом ППО"
        );
        hub.broadcastImpacts(impactManager.getRecentEvents());
      } else if (isImpact) {
        impactManager.createAndRecord(
          "impact",
          lat,
          lon,
          isMunition ? "Крилата/Балістична ракета" : "БПЛА-камікадзе",
          isMunition ? "munition" : "uav",
          "За рапортом очевидця",
          parsed.comment || "Зафіксовано вибух / влучання на місцевості"
        );
        hub.broadcastImpacts(impactManager.getRecentEvents());
      }

      ingestBatch([observation], hub);

      json(res, 200, {
        ok: true,
        message: "Рапорт успішно прийнято та внесено в ситуаційну сітку.",
        trackId: observation.id
      });
    } catch {
      json(res, 400, { error: "Invalid report payload" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/impacts") {
    const events = impactManager.getRecentEvents();
    json(res, 200, {
      count: events.length,
      events
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/simulator/toggle") {
    simulationEnabled = !simulationEnabled;
    json(res, 200, { simulationEnabled });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/drill/inject") {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw) as {
        type: "uav" | "munition" | "aircraft";
        lat: number;
        lon: number;
        heading: number;
        speed: number;
        label?: string;
      };

      const obs: Observation = {
        id: `drill-${Date.now().toString(36)}`,
        type: payload.type || "uav",
        lat: payload.lat,
        lon: payload.lon,
        heading: payload.heading,
        speed: (payload.speed || 180) / 3.6, // km/h to m/s
        timestamp: Date.now(),
        source: "manual",
        confidence: 0.99,
        meta: { drill: true, label: payload.label || "Навчальна ціль" }
      };

      trackManager.ingest(obs);
      hub.broadcastTracks(trackManager.toPackets());
      json(res, 200, { ok: true, injected: obs.id });
    } catch {
      json(res, 400, { error: "Invalid drill payload" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/targets") {
    json(res, 200, {
      count: trackManager.snapshot().length,
      tracks: trackManager.snapshot()
    });
    return;
  }

  if (
    (req.method === "GET" || req.method === "HEAD") &&
    (url.pathname === "/" || url.pathname.startsWith(env.webAppPath) || url.pathname.startsWith("/assets") || url.pathname === "/avatar.jpg" || url.pathname === "/favicon.ico" || url.pathname.endsWith(".geojson") || url.pathname.endsWith(".json"))
  ) {
    await serveClient(req, res);
    return;
  }

  notFound(res);
});

const wss = new WebSocketServer({ noServer: true });
const hub = new RadarHub(wss);
hub.setInitialSnapshotProvider(() => trackManager.toPackets(simulationEnabled));
hub.setBinarySnapshotProvider(() => trackManager.getBinarySnapshot(simulationEnabled));
const botManager = createTelegramBot();
botManager.setHealthTracker(
  healthTracker,
  () => trackManager.snapshot().length,
  () => trackManager.snapshot()
);
botManager.setAlertsSource(alertsSource);

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", env.publicBaseUrl);
  if (url.pathname !== env.wsPath) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

let cycleCounter = 0;

// Periodic main loop: 1 Hz tick for smooth predictive tracking & sensor ingestion
setInterval(async () => {
  const now = Date.now();
  cycleCounter += 1;

  // Poll ADS-B open feed immediately on cycle 1, then every 10 seconds
  if (cycleCounter === 1 || cycleCounter % 10 === 0) {
    const t0 = Date.now();
    try {
      const flights = await airplanesSource.fetchBorderFlights();
      for (const f of flights) {
        trackManager.ingest(f);
      }
      healthTracker.recordSuccess("airplanes.live", Date.now() - t0);
    } catch (err) {
      healthTracker.recordError("airplanes.live", err instanceof Error ? err : String(err));
    }

    // Secondary multi-corridor ADS-B & OpenSky feed
    const tAdsb = Date.now();
    try {
      const flightObs = await openskyLolSource.fetchFlightObservations();
      for (const fo of flightObs) {
        trackManager.ingest(toObservation(fo));
      }
      healthTracker.recordSuccess("adsb.lol", Date.now() - tAdsb);
    } catch (err) {
      healthTracker.recordError("adsb.lol", err instanceof Error ? err : String(err));
    }
  }

  // Poll Local SDR Receiver (dump1090/readsb) every 5 seconds if configured
  if (cycleCounter === 1 || cycleCounter % 5 === 0) {
    const tSdr = Date.now();
    try {
      const sdrObs = await localReceiverSource.fetchLocalReceiverData();
      for (const so of sdrObs) {
        trackManager.ingest(toObservation(so));
      }
      if (sdrObs.length > 0) {
        healthTracker.recordSuccess("local.sdr", Date.now() - tSdr);
      }
    } catch (err) {
      healthTracker.recordError("local.sdr", err instanceof Error ? err : String(err));
    }
  }

  // Poll Alerts immediately on cycle 1, then every 15 seconds
  if (cycleCounter === 1 || cycleCounter % 15 === 0) {
    const t0 = Date.now();
    try {
      await alertsSource.fetchAlerts();
      healthTracker.recordSuccess("alerts.in.ua", Date.now() - t0);
    } catch (err) {
      healthTracker.recordError("alerts.in.ua", err instanceof Error ? err : String(err));
    }
  }

  // Poll Atmospheric Wind Field every 45 seconds
  if (cycleCounter === 1 || cycleCounter % 45 === 0) {
    const t0 = Date.now();
    try {
      await windSource.fetchWind();
      healthTracker.recordSuccess("open-meteo", Date.now() - t0);
    } catch (err) {
      healthTracker.recordError("open-meteo", err instanceof Error ? err : String(err));
    }
  }

  // Poll Public OSINT Feed every 15 seconds
  if (cycleCounter === 1 || cycleCounter % 15 === 0) {
    const tOsint = Date.now();
    try {
      const osintObs = await publicOsintSource.fetchPublicOsintObservations();
      for (const o of osintObs) {
        trackManager.ingest(toObservation(o));
      }
      if (osintObs.length > 0) {
        healthTracker.recordSuccess("public.osint", Date.now() - tOsint, osintObs.length);
      }
    } catch (err) {
      healthTracker.recordError("public.osint", err instanceof Error ? err : String(err));
    }
  }

  // Poll NASA FIRMS Thermal Satellite Observations every 60 seconds
  if (cycleCounter === 1 || cycleCounter % 60 === 0) {
    const t0 = Date.now();
    try {
      const thermals = await firmsSource.fetchThermalObservations();
      for (const t of thermals) {
        trackManager.ingest(t);
      }
      healthTracker.recordSuccess("nasa-firms", Date.now() - t0, thermals.length);
    } catch (err) {
      healthTracker.recordError("nasa-firms", err instanceof Error ? err : String(err));
    }
  }

  // Synthetic simulator runs strictly in test mode / simulationEnabled
  if (simulationEnabled) {
    const simObservations = simulator.generateStep(now);
    for (const obs of simObservations) {
      obs.meta = { ...obs.meta, isSynthetic: true };
      trackManager.ingest(obs);
    }
    healthTracker.recordSuccess("simulator", 1, simObservations.length);
  }

  trackManager.tick(now);
  trackManager.prune(now);

  const delta = trackManager.getDeltaPacket(simulationEnabled, cycleCounter);
  const livePositional = sourceRegistry.getActiveSources().some(src => src.capability.canCreateTrack);
    if (!livePositional) {
    // No confirmed positional sources, send empty track list
    hub.broadcastTracks([], delta.seq, delta.binaryBuffer, delta.removedIds);
  } else {
    hub.broadcastTracks(delta.tracks, delta.seq, delta.binaryBuffer, delta.removedIds);
  }

  if (cycleCounter % 3 === 0) {
    hub.broadcastImpacts(impactManager.getRecentEvents());
  }

  // Broadcast personal threat alerts to bot subscribers
  void botManager.broadcastThreatAlerts(trackManager.snapshot(simulationEnabled));
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
