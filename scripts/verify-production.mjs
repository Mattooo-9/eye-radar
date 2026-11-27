#!/usr/bin/env node
/**
 * Live Production Verification Gate (ACCEPTANCE.md Section 7)
 * Verifies Render backend, Neon Postgres, security guards, zero fabrication,
 * Vercel frontend rewrites, and exact GitHub <-> Render <-> Vercel release parity.
 *
 * Flags:
 *   --expect-sha <sha>         Require both Render & Vercel to match <sha> (prefix >=7)
 *   --expect-render-sha <sha>  Require Render /health releaseSha to match <sha>
 *   --expect-vercel-sha <sha>  Require Vercel /app meta[name=eye-radar-release] to match <sha>
 *   --wait-seconds <N>         Wait up to N seconds for Render rollout to match expected SHA
 */

const RENDER_BASE = process.env.RENDER_URL || "https://eye-radar.onrender.com";
const VERCEL_BASE = process.env.VERCEL_URL || "https://eye-radar.vercel.app";

const args = process.argv.slice(2);
const readArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
};

const expectBothSha = readArg("--expect-sha") || process.env.EXPECT_RELEASE_SHA || "";
const expectRenderSha = readArg("--expect-render-sha") || expectBothSha;
const expectVercelSha = readArg("--expect-vercel-sha") || expectBothSha;
const waitSeconds = Math.max(0, Number(readArg("--wait-seconds") || process.env.WAIT_SECONDS || "0") || 0);

const CIVIL_PREFIXES = [
  "WZZ", "RYR", "THY", "PGT", "AAR", "LOT", "DLH", "KLM", "AFR", "BAW", "AUA", "SXS", "EZY", "BTI", "ENT", "FDB"
];

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} — ${detail}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shaMatches = (actual, expected) => {
  if (!expected) return true;
  if (!actual || actual === "unknown" || actual === "dev") return false;
  const a = String(actual).toLowerCase();
  const e = String(expected).toLowerCase();
  return a.startsWith(e.slice(0, 7)) || e.startsWith(a.slice(0, 7));
};

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await sleep(2000 * (i + 1));
      }
    }
  }
  throw lastErr;
}

async function fetchJson(url, options = {}) {
  const res = await fetchWithRetry(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, bytes: Buffer.byteLength(text, "utf8"), json, text };
}

async function waitForRenderRollout() {
  let health = await fetchJson(`${RENDER_BASE}/health`);
  if (!expectRenderSha || waitSeconds <= 0 || shaMatches(health.json?.releaseSha, expectRenderSha)) {
    return health;
  }

  const deadline = Date.now() + waitSeconds * 1000;
  console.log(
    `INFO | Waiting up to ${waitSeconds}s for Render releaseSha=${expectRenderSha.slice(0, 7)} (current=${String(
      health.json?.releaseSha || "none"
    ).slice(0, 7)})...`
  );
  while (Date.now() < deadline) {
    await sleep(10_000);
    try {
      health = await fetchJson(`${RENDER_BASE}/health`, {}, 1);
      if (shaMatches(health.json?.releaseSha, expectRenderSha)) {
        console.log(`INFO | Render rolled out releaseSha=${String(health.json?.releaseSha).slice(0, 7)}`);
        return health;
      }
    } catch {}
  }
  return health;
}

async function main() {
  // 1. Render /health (with optional post-deploy rollout wait)
  const health = await waitForRenderRollout();
  const renderSha = String(health.json?.releaseSha || "unknown");
  check(
    "Render /health online & Neon DB connected",
    health.status === 200 && health.json?.ok === true && health.json?.database?.ok === true,
    `HTTP ${health.status}, db=${health.json?.database?.ok} (${health.json?.database?.latencyMs}ms), mem=${health.json?.watchdog?.memoryMb}MB, sha=${renderSha.slice(0, 7)}, health=${health.json?.summary?.overallHealth}`
  );
  check(
    "Render RAM within lean budget (<180MB)",
    typeof health.json?.watchdog?.memoryMb === "number" && health.json.watchdog.memoryMb < 180,
    `mem=${health.json?.watchdog?.memoryMb}MB`
  );
  check(
    "Telegram channels completely disconnected (0 Telegram sources)",
    (health.json?.osintChannels?.totalChannels ?? -1) === 0 &&
      health.json?.osintChannels?.telegramScrapingDisabled === true,
    `totalChannels=${health.json?.osintChannels?.totalChannels}, telegramScrapingDisabled=${health.json?.osintChannels?.telegramScrapingDisabled}`
  );
  check(
    "Neon Postgres intelligenceStore active",
    Boolean(health.json?.intelligenceDb?.connected),
    `connected=${health.json?.intelligenceDb?.connected}, bulletins=${health.json?.intelligenceDb?.bulletinsStored}, snapshots=${health.json?.intelligenceDb?.snapshotsStored}`
  );
  check(
    "Automated technical failure monitor active in /health",
    Boolean(health.json?.monitoring) &&
      ["OK", "DEGRADED", "CRITICAL"].includes(health.json?.monitoring?.status) &&
      health.json?.monitoring?.status !== "CRITICAL",
    `status=${health.json?.monitoring?.status}, activeIncidents=${health.json?.monitoring?.activeIncidentsCount ?? "n/a"}, runtimeErrors=${health.json?.monitoring?.runtimeErrorsCount ?? "n/a"}`
  );
  check(
    "Centralized lifecycle & self-cleaning policy active in /health",
    Boolean(health.json?.lifecycle) && typeof health.json?.lifecycle?.sweepsRun === "number",
    `sweeps=${health.json?.lifecycle?.sweepsRun}, lastSweepAt=${health.json?.lifecycle?.lastSweepAt}`
  );

  // 2. Render /api/targets truthfulness & separation
  const targets = await fetchJson(`${RENDER_BASE}/api/targets`);
  const tracks = Array.isArray(targets.json?.tracks) ? targets.json.tracks : [];
  const synthCount = tracks.filter((t) => t.isSynthetic).length;
  const civilLeak = tracks.filter((t) => {
    const cs = String(t.callsign || "").toUpperCase();
    return t.type === "aircraft" && CIVIL_PREFIXES.some((p) => cs.startsWith(p));
  });
  const missingProvenance = tracks.filter(
    (t) => !t.timestamp || !Array.isArray(t.provenanceChain) || t.provenanceChain.length === 0
  );
  const missingCategory = tracks.filter(
    (t) => t.dataCategory !== "osint_message" && t.dataCategory !== "sensor_observation"
  );
  const osintFakeAlt = tracks.filter(
    (t) => t.dataCategory === "osint_message" && (t.altitude !== undefined && t.altitude !== null)
  );
  const osintFakeMeasuredSpeed = tracks.filter(
    (t) => t.dataCategory === "osint_message" && (t.measuredSpeed !== undefined && t.measuredSpeed !== null)
  );
  const osintFalsePrecision = tracks.filter(
    (t) => t.dataCategory === "osint_message" && typeof t.uncertaintyRadius === "number" && t.uncertaintyRadius < 2500
  );
  const telegramOrFakeRadarTracks = tracks.filter(
    (t) =>
      String(t.callsign || "").startsWith("@") ||
      (t.dataCategory === "osint_message" && typeof t.speed === "number" && t.speed > 0)
  );
  const evidenceBloat = tracks.filter((t) => Array.isArray(t.evidence) && t.evidence.length > 24);

  check(
    "/api/targets compact payload (<100KB) & explicit categories",
    targets.status === 200 && targets.bytes < 100_000 && Boolean(targets.json?.categories),
    `${(targets.bytes / 1024).toFixed(1)} KB, count=${tracks.length}, categories=${JSON.stringify(targets.json?.categories)}`
  );
  check("0 synthetic tracks in production", synthCount === 0, `synthetic=${synthCount}`);
  check("0 European commercial airline leakages", civilLeak.length === 0, `civilLeak=${civilLeak.map((c) => c.callsign).join(",") || "none"}`);
  check("100% tracks carry timestamp & provenanceChain", missingProvenance.length === 0, `missing=${missingProvenance.length}/${tracks.length}`);
  check("100% tracks strictly tagged with dataCategory", missingCategory.length === 0, `missing=${missingCategory.length}/${tracks.length}`);
  check("0 fabricated altitudes on textual OSINT tracks", osintFakeAlt.length === 0, `fakeAlt=${osintFakeAlt.length}`);
  check("0 fabricated measuredSpeed on textual OSINT tracks", osintFakeMeasuredSpeed.length === 0, `fakeSpd=${osintFakeMeasuredSpeed.length}`);
  check("0 false sub-2.5km precision on textual OSINT tracks", osintFalsePrecision.length === 0, `falsePrec=${osintFalsePrecision.length}`);
  check(
    "0 Telegram-sourced tracks or false moving radar extrapolations from text",
    telegramOrFakeRadarTracks.length === 0,
    `violations=${telegramOrFakeRadarTracks.length}`
  );
  check("Bounded deduplicated evidence arrays (<=24)", evidenceBloat.length === 0, `bloated=${evidenceBloat.length}`);

  // 3. No synthetic EO dummy payload
  const eo = await fetchJson(`${RENDER_BASE}/api/eo/change-detection`);
  check(
    "/api/eo/change-detection returns honest unavailable (no dummy grid)",
    eo.status === 200 && eo.json?.available === false,
    JSON.stringify(eo.json)
  );

  // 4. Security & failure handling checks
  const missingDiag = await fetchJson(`${RENDER_BASE}/api/tracks/nonexistent-track-id-check/diagnostic`);
  check("Missing track diagnostic degrades cleanly with HTTP 404", missingDiag.status === 404, `HTTP ${missingDiag.status}`);

  const botDiagUnauth = await fetchJson(`${RENDER_BASE}/api/bot/diagnostic-lifecycle`);
  check("Admin diagnostic endpoint rejects unauthenticated requests (HTTP 401)", botDiagUnauth.status === 401, `HTTP ${botDiagUnauth.status}`);

  const monitoringUnauth = await fetchJson(`${RENDER_BASE}/api/monitoring/incidents`);
  check("Monitoring incidents endpoint rejects unauthenticated requests (HTTP 401)", monitoringUnauth.status === 401, `HTTP ${monitoringUnauth.status}`);

  const ingestUnauthRes = await fetchWithRetry(`${RENDER_BASE}/api/ingest/osint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "test" })
  });
  check("OSINT ingest endpoint rejects unauthenticated writes (HTTP 401)", ingestUnauthRes.status === 401, `HTTP ${ingestUnauthRes.status}`);

  const badReportRes = await fetchWithRetry(`${RENDER_BASE}/api/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "uav_sound", lat: 10, lon: 10 })
  });
  check("Citizen /api/report rejects out-of-Ukraine coordinates (HTTP 400)", badReportRes.status === 400, `HTTP ${badReportRes.status}`);

  const alertHistory = await fetchJson(`${RENDER_BASE}/api/alerts/history`);
  check(
    "Anonymized official alert history endpoint active (30-day retention)",
    alertHistory.status === 200 &&
      alertHistory.json?.dataCategory === "official_alert" &&
      alertHistory.json?.retentionDays === 30 &&
      Array.isArray(alertHistory.json?.history),
    `HTTP ${alertHistory.status}, retentionDays=${alertHistory.json?.retentionDays}, count=${alertHistory.json?.count}`
  );

  // 5. Vercel production frontend + rewrites + official alert metadata + release SHA parity
  const vercelApp = await fetchWithRetry(`${VERCEL_BASE}/app`);
  const vercelHtml = await vercelApp.text();
  const scriptMatch = vercelHtml.match(/\/assets\/index-[^"]+\.js/);
  const releaseMetaMatch = vercelHtml.match(/<meta\s+name="eye-radar-release"\s+content="([^"]+)"/i);
  const vercelSha = releaseMetaMatch?.[1] || "unknown";
  const vercelFeed = await fetchJson(`${VERCEL_BASE}/api/osint/feed?limit=3`);
  const vercelAlerts = await fetchJson(`${VERCEL_BASE}/api/alerts`);

  check(
    "Vercel /app serves HTTP 200 with fresh client bundle",
    vercelApp.status === 200 && Boolean(scriptMatch),
    `HTTP ${vercelApp.status}, bundle=${scriptMatch?.[0] ?? "none"}, sha=${vercelSha.slice(0, 7)}`
  );

  const pmtilesRes = await fetchWithRetry(`${VERCEL_BASE}/tiles/ukraine-overview.pmtiles`, {
    headers: { Range: "bytes=0-126" }
  });
  const pmtilesBuf = Buffer.from(await pmtilesRes.arrayBuffer());
  const pmtilesMagic = pmtilesBuf.subarray(0, 7).toString("ascii");
  check(
    "Protomaps PMTiles v3 archive serves HTTP Range requests on Vercel CDN",
    (pmtilesRes.status === 206 || pmtilesRes.status === 200) &&
      pmtilesMagic === "PMTiles" &&
      pmtilesBuf[7] === 3,
    `HTTP ${pmtilesRes.status}, magic=${pmtilesMagic}, version=${pmtilesBuf[7]}, bytes=${pmtilesBuf.byteLength}, cors=${pmtilesRes.headers.get("access-control-allow-origin")}`
  );
  check(
    "Vercel /api/osint/feed & /api/alerts carry official status, timestamp & freshness",
    vercelFeed.status === 200 &&
      vercelAlerts.status === 200 &&
      vercelAlerts.json?.dataCategory === "official_alert" &&
      vercelAlerts.json?.status === "fresh" &&
      vercelAlerts.json?.sourceAvailable === true &&
      typeof vercelAlerts.json?.lastConfirmedAt === "number" &&
      vercelAlerts.json.lastConfirmedAt > 0 &&
      typeof vercelAlerts.json?.source === "string" &&
      vercelAlerts.json?.stale === false,
    `feed=${vercelFeed.json?.count ?? 0}, alerts=${vercelAlerts.json?.count ?? 0}, status=${vercelAlerts.json?.status}, src=${vercelAlerts.json?.source}, lastConfirmedAt=${vercelAlerts.json?.lastConfirmedAt}`
  );

  // 6. GitHub <-> Render <-> Vercel release SHA synchronization check
  const renderShaValid = renderSha !== "unknown" && renderSha !== "dev" && renderSha.length >= 7;
  const vercelShaValid = vercelSha !== "unknown" && vercelSha.length >= 7;
  const expectedRenderOk = shaMatches(renderSha, expectRenderSha);
  const expectedVercelOk = shaMatches(vercelSha, expectVercelSha);
  const crossServiceParity = !expectRenderSha && !expectVercelSha
    ? renderShaValid && vercelShaValid && renderSha.slice(0, 7) === vercelSha.slice(0, 7)
    : expectedRenderOk && expectedVercelOk;

  check(
    "GitHub <-> Render <-> Vercel release SHA synchronized",
    renderShaValid && vercelShaValid && crossServiceParity,
    `render=${renderSha.slice(0, 7)}, vercel=${vercelSha.slice(0, 7)}${expectRenderSha ? `, expectRender=${expectRenderSha.slice(0, 7)}` : ""}${expectVercelSha ? `, expectVercel=${expectVercelSha.slice(0, 7)}` : ""}`
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} PASSED, ${failed.length} FAILED`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Production verification crashed:", err);
  process.exit(1);
});
