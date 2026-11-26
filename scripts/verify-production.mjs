// scripts/verify-production.mjs
// Automated live production acceptance probe against Render backend & Vercel frontend.
// Exits non-zero if ANY mandatory production invariant fails.

const RENDER_BASE = process.env.RENDER_URL || "https://eye-radar.onrender.com";
const VERCEL_BASE = process.env.VERCEL_URL || "https://eye-radar.vercel.app";

const CIVIL_PREFIXES = [
  "RYR", "WZZ", "WMT", "WUK", "LOT", "DLH", "KLM", "AFR", "BAW", "THY", "AUA",
  "SXS", "PGT", "EZY", "EZS", "SAS", "FIN", "BTI", "ENT", "TOM", "FDB", "AAR",
  "ETH", "ROT", "CAI", "ISR", "FDX", "UPS", "EXS", "CCA", "SIA", "RYS", "NSZ",
  "VLG", "UAE", "QTR", "ETD", "ELY", "AEE", "TVS", "MSC"
];

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} — ${detail}`);
};

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, bytes: Buffer.byteLength(text, "utf8"), json, text };
}

async function main() {
  // 1. Render /health
  const health = await fetchJson(`${RENDER_BASE}/health`);
  check(
    "Render /health online & Neon DB connected",
    health.status === 200 && Boolean(health.json?.ok) && Boolean(health.json?.database?.ok),
    `HTTP ${health.status}, db=${health.json?.database?.ok} (${health.json?.database?.latencyMs}ms), mem=${health.json?.watchdog?.memoryMb}MB, health=${health.json?.summary?.overallHealth}`
  );
  check(
    "Render RAM within lean budget (<180MB)",
    typeof health.json?.watchdog?.memoryMb === "number" && health.json.watchdog.memoryMb < 180,
    `mem=${health.json?.watchdog?.memoryMb}MB`
  );
  check(
    "14 OSINT channels registered & healthy",
    (health.json?.osintChannels?.totalChannels ?? 0) >= 14 && (health.json?.osintChannels?.respondingChannels ?? 0) >= 10,
    `${health.json?.osintChannels?.respondingChannels}/${health.json?.osintChannels?.totalChannels} responding`
  );
  check(
    "Neon Postgres intelligenceStore active",
    Boolean(health.json?.intelligenceDb?.connected),
    `connected=${health.json?.intelligenceDb?.connected}, bulletins=${health.json?.intelligenceDb?.bulletinsStored}, snapshots=${health.json?.intelligenceDb?.snapshotsStored}`
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
  check("Bounded deduplicated evidence arrays (<=24)", evidenceBloat.length === 0, `bloated=${evidenceBloat.length}`);

  // 3. No synthetic EO dummy payload
  const eo = await fetchJson(`${RENDER_BASE}/api/eo/change-detection`);
  check(
    "/api/eo/change-detection returns honest unavailable (no dummy grid)",
    eo.status === 200 && eo.json?.available === false,
    JSON.stringify(eo.json)
  );

  // 4. Failure / missing track handling (404 clean, never 500)
  const missingDiag = await fetchJson(`${RENDER_BASE}/api/tracks/nonexistent-track-id-check/diagnostic`);
  check(
    "Missing track diagnostic degrades cleanly with HTTP 404",
    missingDiag.status === 404,
    `HTTP ${missingDiag.status}`
  );

  // 5. Vercel production frontend + rewrites
  const vercelApp = await fetch(`${VERCEL_BASE}/app`, { signal: AbortSignal.timeout(15_000) });
  const vercelHtml = await vercelApp.text();
  const scriptMatch = vercelHtml.match(/\/assets\/index-[^"]+\.js/);
  const vercelFeed = await fetchJson(`${VERCEL_BASE}/api/osint/feed?limit=3`);
  const vercelAlerts = await fetchJson(`${VERCEL_BASE}/api/alerts`);

  check(
    "Vercel /app serves HTTP 200 with fresh client bundle",
    vercelApp.status === 200 && Boolean(scriptMatch),
    `HTTP ${vercelApp.status}, bundle=${scriptMatch?.[0] ?? "none"}`
  );
  check(
    "Vercel /api/osint/feed & /api/alerts rewrites healthy",
    vercelFeed.status === 200 && vercelAlerts.status === 200,
    `feed=${vercelFeed.json?.count ?? 0} items, alerts=${vercelAlerts.json?.count ?? 0}`
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
