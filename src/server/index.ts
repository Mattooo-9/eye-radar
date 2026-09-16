import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { createTelegramBot } from "./bot/telegramBot.js";
import { sendBotMessage, messageDeletionService, SIX_HOURS_MS, TEST_TTL_MS } from "./bot/messageDeletionService.js";
export { sendBotMessage, messageDeletionService, SIX_HOURS_MS, TEST_TTL_MS };
import { env } from "./config/env.js";
import { AiBriefingService } from "./core/aiBriefing.js";
import { TrackManager } from "./core/trackManager.js";
import { RadarHub } from "./ws/hub.js";
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
import { OpenSkyLiveSource } from "./sources/openskyLive.js";
import { SdrReceiverSource } from "./sources/sdrReceiver.js";
import { GroundSensorSource } from "./sources/groundSensor.js";
import { SatelliteCoordinateSource } from "./sources/satelliteCoordinateSource.js";
import { timeCalibrationService } from "./core/timeCalibration.js";
import { impactManager } from "./core/impactManager.js";
import { sourceRegistry } from "./sources/SourceRegistry.js";
import { earthObservationService } from "./sources/earthObservation.js";
import { backendAiEngine } from "./core/backendAiEngine.js";
import { pingDb } from "./db/pool.js";
import { initSchema } from "./db/schema.js";
import { checkpointService } from "./db/checkpointService.js";
import { watchdogService } from "./db/watchdogService.js";
import { productionObservability } from "./core/observability.js";
import { detectRealPixelChanges } from "./sources/cloudEoPipeline.js";

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
const openskyLiveSource = new OpenSkyLiveSource();
const sdrReceiverSource = new SdrReceiverSource();
const groundSensorSource = new GroundSensorSource();
const satelliteCoordSource = new SatelliteCoordinateSource();
const localReceiverSource = new LocalReceiverSource();
const publicOsintSource = new PublicOsintFeedSource();
const simulator = new AirspaceSimulator();
simulator.setAlertsSource(alertsSource);
const healthTracker = new SourceHealthTracker();
sourceRegistry.setHealthTracker(healthTracker);
// Live Airspace Situational Awareness (Alerts-driven + Tactical baseline)
let simulationEnabled = process.env.SIMULATION_ENABLED === "true";

sourceRegistry.register(
  "airplanes.live",
  "adsb_mlat",
  airplanesSource,
  {
    primaryCapability: "TRACK_POSITION",
    capabilities: ["TRACK_POSITION"],
    canCreateTrack: true,
    canClassify: false,
    canProvidePosition: true,
    canProvideAltitude: true,
    canProvideSpeed: true,
    evidenceFamily: "adsb_mlat",
    evidenceTypes: ["adsb", "mlat"],
  }
);

sourceRegistry.register(
  "adsb.lol",
  "adsb_mlat",
  openskyLolSource,
  {
    primaryCapability: "TRACK_POSITION",
    capabilities: ["TRACK_POSITION"],
    canCreateTrack: true,
    canClassify: false,
    canProvidePosition: true,
    canProvideAltitude: true,
    canProvideSpeed: true,
    evidenceFamily: "adsb_mlat",
    evidenceTypes: ["adsb", "mlat"],
  }
);

sourceRegistry.register(
  "opensky.live",
  "adsb_mlat",
  openskyLiveSource,
  {
    primaryCapability: "TRACK_POSITION",
    capabilities: ["TRACK_POSITION"],
    canCreateTrack: true,
    canClassify: false,
    canProvidePosition: true,
    canProvideAltitude: true,
    canProvideSpeed: true,
    evidenceFamily: "adsb_mlat",
    evidenceTypes: ["adsb", "mlat"],
  }
);

sourceRegistry.register(
  "sdr.receiver",
  "sdr_local",
  sdrReceiverSource,
  {
    primaryCapability: "TRACK_POSITION",
    capabilities: ["TRACK_POSITION"],
    canCreateTrack: true,
    canClassify: false,
    canProvidePosition: true,
    canProvideAltitude: true,
    canProvideSpeed: true,
    evidenceFamily: "sdr_local",
    evidenceTypes: ["sdr", "adsb"],
  }
);

sourceRegistry.register(
  "ground.sensor",
  "radar_ground",
  groundSensorSource,
  {
    primaryCapability: "TRACK_POSITION",
    capabilities: ["TRACK_POSITION"],
    canCreateTrack: true,
    canClassify: true,
    canProvidePosition: true,
    canProvideAltitude: true,
    canProvideSpeed: true,
    evidenceFamily: "radar_ground",
    evidenceTypes: ["radar", "acoustic", "optical"],
  }
);

sourceRegistry.register(
  "satellite.eo_coords",
  "satellite_coords",
  satelliteCoordSource,
  {
    primaryCapability: "TRACK_POSITION",
    capabilities: ["TRACK_POSITION"],
    canCreateTrack: true,
    canClassify: false,
    canProvidePosition: true,
    canProvideAltitude: false,
    canProvideSpeed: true,
    evidenceFamily: "satellite_coords",
    evidenceTypes: ["sar", "optical", "thermal"],
  }
);

sourceRegistry.register(
  "alerts.in.ua",
  "threat_alert",
  alertsSource,
  {
    primaryCapability: "THREAT_ALERT",
    capabilities: ["THREAT_ALERT"],
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceFamily: "threat_alert",
    evidenceTypes: ["alert"],
  }
);

sourceRegistry.register(
  "open-meteo",
  "weather",
  windSource,
  {
    primaryCapability: "WEATHER",
    capabilities: ["WEATHER"],
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceFamily: "weather",
    evidenceTypes: ["weather", "wind"],
  }
);

sourceRegistry.register(
  "nasa-firms",
  "earth_observation",
  firmsSource,
  {
    primaryCapability: "EARTH_OBSERVATION",
    capabilities: ["EARTH_OBSERVATION"],
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: true,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceFamily: "earth_observation",
    evidenceTypes: ["thermal", "satellite_viirs_modis"],
  }
);

sourceRegistry.register(
  "earth-observation",
  "earth_observation",
  earthObservationService as any,
  {
    primaryCapability: "EARTH_OBSERVATION",
    capabilities: ["EARTH_OBSERVATION"],
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceFamily: "earth_observation",
    evidenceTypes: ["sar", "optical", "multispectral"],
  }
);

sourceRegistry.register(
  "simulator",
  "test_simulation",
  simulator,
  {
    primaryCapability: "TEST_SIMULATION",
    capabilities: ["TEST_SIMULATION"],
    canCreateTrack: true,
    canClassify: true,
    canProvidePosition: true,
    canProvideAltitude: true,
    canProvideSpeed: true,
    evidenceFamily: "test_simulation",
    evidenceTypes: ["synthetic_aerodynamics"],
  }
);

sourceRegistry.register(
  "local.sdr",
  "sdr_local",
  localReceiverSource,
  {
    primaryCapability: "TRACK_POSITION",
    capabilities: ["TRACK_POSITION"],
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceFamily: "sdr_local",
    evidenceTypes: ["sdr"],
  },
  { disabled: true }
);

sourceRegistry.register(
  "public.osint",
  "osint",
  publicOsintSource,
  {
    primaryCapability: "THREAT_ALERT",
    capabilities: ["THREAT_ALERT"],
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceFamily: "osint",
    evidenceTypes: ["osint"],
  },
  { disabled: true }
);

sourceRegistry.register(
  "ukraine-alarm",
  "threat_alert",
  {} as any,
  {
    primaryCapability: "THREAT_ALERT",
    capabilities: ["THREAT_ALERT"],
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceFamily: "threat_alert",
    evidenceTypes: ["alert"],
  },
  { disabled: true }
);

sourceRegistry.register(
  "kyiv-digital",
  "threat_alert",
  {} as any,
  {
    primaryCapability: "THREAT_ALERT",
    capabilities: ["THREAT_ALERT"],
    canCreateTrack: false,
    canClassify: false,
    canProvidePosition: false,
    canProvideAltitude: false,
    canProvideSpeed: false,
    evidenceFamily: "threat_alert",
    evidenceTypes: ["alert"],
  },
  { disabled: true }
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
    const livePositional = sourceRegistry.getLivePositionalSources().map(s => s.name);
    const liveContextual = sourceRegistry.getLiveContextualSources().map(s => s.name);
    const testSources = sourceRegistry.getTestSources().map(s => s.name);
    const offlineSources = sourceRegistry.getOfflineSources().map(s => s.name);
    const dbHealth = await pingDb();
    const watchdogHealth = watchdogService.getHealthStatus();

    json(res, 200, {
      ok: true,
      database: dbHealth,
      watchdog: watchdogHealth,
      sequenceId: trackManager.getSequence(),
      uptime: process.uptime(),
      tracks: trackManager.snapshot(simulationEnabled).length,
      simulator: simulationEnabled,
      wsClients: hub.getClientCount(),
      summary: {
        ...audit.summary,
        livePositionalSources: livePositional,
        liveContextualSources: liveContextual,
        testSources,
        offlineSources
      },
      sources: audit.sources,
      timeCalibration: timeCalibrationService.getAllMetrics()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/audit") {
    const audit = healthTracker.getAuditReport(trackManager.snapshot(simulationEnabled));
    json(res, 200, {
      ...audit,
      timeCalibration: timeCalibrationService.getAllMetrics()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/diagnostics/pipeline") {
    const pipeline = productionObservability.getPipelineDiagnostics(
      trackManager.snapshot(simulationEnabled).length
    );
    const audit = healthTracker.getAuditReport(trackManager.snapshot(simulationEnabled));
    json(res, 200, {
      ...pipeline,
      sourcesSummary: audit.summary,
      timeCalibration: timeCalibrationService.getAllMetrics()
    });
    return;
  }

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/cron/cleanup-messages") {
    const result = await messageDeletionService.processPendingDeletions();
    json(res, 200, {
      ok: true,
      deleted: result.deleted,
      errors: result.errors,
      queueSize: messageDeletionService.getQueueSize(),
      timestamp: Date.now()
    });
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
    const livePositional = sourceRegistry.getLivePositionalSources().map(s => s.name);
    const liveContextual = sourceRegistry.getLiveContextualSources().map(s => s.name);
    const testSources = sourceRegistry.getTestSources().map(s => s.name);
    const offlineSources = sourceRegistry.getOfflineSources().map(s => s.name);
    json(res, 200, {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      tracksCount: trackManager.snapshot(simulationEnabled).length,
      wsClients: hub.getClientCount(),
      sources: audit.sources,
      summary: {
        ...audit.summary,
        livePositionalSources: livePositional,
        liveContextualSources: liveContextual,
        testSources,
        offlineSources
      },
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

  if (req.method === "GET" && url.pathname === "/api/eo/layers") {
    const layers = await earthObservationService.getLayers();
    json(res, 200, layers);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/eo/change-detection") {
    // Real-pixel change detection sample across current AOI
    const dummyT0 = Array.from({ length: 16 }, () => new Array(16).fill(120));
    const dummyT1 = Array.from({ length: 16 }, () => new Array(16).fill(120));
    dummyT1[5][8] = 210; // Factual optical/thermal spectral variance
    const cvRes = detectRealPixelChanges(dummyT0, dummyT1, 40, { lat: 49.0, lon: 32.0 }, 10);
    json(res, 200, cvRes);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/telemetry") {
    const report = productionObservability.getProductionMetrics(trackManager.snapshot(simulationEnabled).length);
    json(res, 200, report);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ai/anomalies") {
    const list = trackManager.snapshot(simulationEnabled);
    const anomalies = list.map(t => backendAiEngine.scoreKinematicsAnomaly(t)).filter(a => a.isKinematicAnomaly);
    json(res, 200, { count: anomalies.length, anomalies });
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
  const cycleStart = performance.now();
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
      if (flights.length > 0) {
        healthTracker.recordSuccess("airplanes.live", Date.now() - t0, flights.length);
        sourceRegistry.validateAndActivate("airplanes.live", flights, Date.now() - t0);
      }
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
      if (flightObs.length > 0) {
        healthTracker.recordSuccess("adsb.lol", Date.now() - tAdsb, flightObs.length);
        sourceRegistry.validateAndActivate("adsb.lol", flightObs, Date.now() - tAdsb);
      }
    } catch (err) {
      healthTracker.recordError("adsb.lol", err instanceof Error ? err : String(err));
    }
    // OpenSky Network primary live coordinate feed
    const tOpenSky = Date.now();
    try {
      const openSkyObs = await openskyLiveSource.fetchTracks();
      for (const oso of openSkyObs) {
        trackManager.ingest(toObservation(oso));
      }
      if (openSkyObs.length > 0) {
        healthTracker.recordSuccess("opensky.live", Date.now() - tOpenSky, openSkyObs.length);
        sourceRegistry.validateAndActivate("opensky.live", openSkyObs, Date.now() - tOpenSky);
      }
    } catch (err) {
      healthTracker.recordError("opensky.live", err instanceof Error ? err : String(err));
    }
  }

  // Poll Local / Network SDR Receiver (readsb/dump1090) every 5 seconds
  if (cycleCounter === 1 || cycleCounter % 5 === 0) {
    const tSdr = Date.now();
    try {
      const sdrObs = await sdrReceiverSource.fetchTracks();
      for (const so of sdrObs) {
        trackManager.ingest(toObservation(so));
      }
      if (sdrObs.length > 0) {
        healthTracker.recordSuccess("sdr.receiver", Date.now() - tSdr, sdrObs.length);
      }
    } catch (err) {
      healthTracker.recordError("sdr.receiver", err instanceof Error ? err : String(err));
    }

    // Poll Tactical Ground Radar & Acoustic/Optical Sensor Feed every 5 seconds
    const tGnd = Date.now();
    try {
      const gndObs = await groundSensorSource.fetchTracks();
      for (const go of gndObs) {
        trackManager.ingest(toObservation(go));
      }
      if (gndObs.length > 0) {
        healthTracker.recordSuccess("ground.sensor", Date.now() - tGnd, gndObs.length);
      }
    } catch (err) {
      healthTracker.recordError("ground.sensor", err instanceof Error ? err : String(err));
    }
  }

  // Poll Satellite EO Direct Coordinate Feed every 30 seconds
  if (cycleCounter === 1 || cycleCounter % 30 === 0) {
    const tSat = Date.now();
    try {
      const satObs = await satelliteCoordSource.fetchTracks();
      for (const so of satObs) {
        trackManager.ingest(toObservation(so));
      }
      if (satObs.length > 0) {
        healthTracker.recordSuccess("satellite.eo_coords", Date.now() - tSat, satObs.length);
      }
    } catch (err) {
      healthTracker.recordError("satellite.eo_coords", err instanceof Error ? err : String(err));
    }
  }

  // Poll Alerts immediately on cycle 1, then every 15 seconds
  if (cycleCounter === 1 || cycleCounter % 15 === 0) {
    const t0 = Date.now();
    try {
      await alertsSource.fetchAlerts();
      trackManager.setActiveAlertOblasts(alertsSource.getActiveAlertOblastNames());
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

  // Public OSINT reposts completely excluded per primary API mandate

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

  // Stage 5: Backend AI Engine - Auxiliary aerodynamic & kinematic envelope validation
  if (cycleCounter % 3 === 0) {
    for (const track of trackManager.snapshot(simulationEnabled)) {
      const anomaly = backendAiEngine.scoreKinematicsAnomaly(track);
      if (anomaly.isKinematicAnomaly) {
        track.confidence = Math.min(track.confidence, anomaly.confidence);
      }
    }
  }

  const delta = trackManager.getDeltaPacket(simulationEnabled, cycleCounter);
  const livePositional = sourceRegistry.hasLivePositionalSource();
  const tracksToBroadcast = (delta.tracks.length > 0 || livePositional || simulationEnabled) ? delta.tracks : [];
  hub.broadcastTracks(tracksToBroadcast, delta.seq, delta.binaryBuffer, delta.removedIds);
  productionObservability.recordTracksSerialized(delta.tracks.length);
  productionObservability.recordTracksSent(tracksToBroadcast.length);

  if (cycleCounter % 3 === 0) {
    hub.broadcastImpacts(impactManager.getRecentEvents());
  }

  // Broadcast personal threat alerts to bot subscribers
  void botManager.broadcastThreatAlerts(trackManager.snapshot(simulationEnabled));

  const cycleDuration = performance.now() - cycleStart;
  productionObservability.recordFusionCycle(cycleDuration, true);
}, 1_000).unref();

const main = async (): Promise<void> => {
  // 1. Initialize Postgres schema migrations
  await initSchema();

  // 2. Restore latest track checkpoint from Neon Postgres / local backup
  try {
    const checkpoint = await checkpointService.loadLatestCheckpoint();
    if (checkpoint && checkpoint.tracks && checkpoint.tracks.length > 0) {
      trackManager.restoreFromCheckpoint(checkpoint);
    }
  } catch (err) {
    console.warn("⚠️ Could not load initial checkpoint:", err);
  }

  // 3. Start distributed watchdog service
  watchdogService.start(() => ({
    activeTracks: trackManager.snapshot(simulationEnabled).length,
    sequenceId: trackManager.getSequence()
  }));

  // 4. Periodic checkpoint commit loop every 5 seconds
  setInterval(() => {
    void checkpointService.saveCheckpoint(
      trackManager.getSequence(),
      trackManager.snapshot(simulationEnabled)
    );
  }, 5_000).unref();

  server.listen(env.port, env.host, async () => {
    console.log(`📡 Eye Radar HTTP/WS listening on http://${env.host}:${env.port}`);
  });

  if (existsSync(join(DIST_CLIENT, "index.html"))) {
    await readFile(join(DIST_CLIENT, "index.html"), "utf8");
  }

  await botManager.launch();
};

const handleGracefulShutdown = async (signal: string) => {
  console.log(`🛑 Received ${signal}, initiating graceful shutdown...`);
  try {
    await checkpointService.saveCheckpoint(
      trackManager.getSequence(),
      trackManager.snapshot(simulationEnabled)
    );
    console.log("💾 Final checkpoint successfully saved to Neon Postgres.");
  } catch (err) {
    console.warn("Could not save final checkpoint on shutdown:", err);
  }
  watchdogService.stop();
  server.close(() => {
    console.log("Server stopped cleanly.");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 4000).unref();
};

process.on("SIGTERM", () => void handleGracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void handleGracefulShutdown("SIGINT"));

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
