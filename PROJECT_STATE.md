# Eye Radar — Project State & Architectural Baseline

**Status:** Stable Production Baseline (Control Audit Passed)  
**Production Topology:**
- **Frontend / Mini App / Proxies / Cron (Vercel):** `https://eye-radar.vercel.app`
- **Backend / Streaming / Fusion Worker (Render):** `https://eye-radar.onrender.com` (24/7 worker + `wss://eye-radar.onrender.com/ws`)
- **Database (Neon PostgreSQL):** Single source of truth for checkpoints (`radar_checkpoints`), persistent OSINT bulletins (`osint_bulletins`, 24 h retention), historical track snapshots (`track_history_snapshots`, 2 h retention), anonymized official civil alert history (`official_alert_history`, 30 d retention), diagnostic logs (`diagnostic_logs`, 7 d retention), user preferences (`user_preferences`, 3-decimal privacy-minimized coordinates + 30 d inactive cleanup), unified Telegram message lifecycle queue (`bot_message_deletion_queue`), and watchdog (`worker_watchdog`, `worker_locks`).
- **Telegram Bot (`@AppEye_bot`):** Permanent main menu (`category="main_menu"`), active civil warnings held until official all-clear and auto-deleted 30 minutes after all-clear (`category="active_warning"`), standard notifications auto-deleted after 6 hours, ephemeral service replies auto-deleted after 15 minutes (`category="ephemeral"`), and in-place `editMessageText` deduplication via `dedupKey`.
- **Cartographic Basemap (Protomaps / PMTiles v3 + OpenFreeMap + Esri):** `src/client/lib/mapStyles.ts` registers the official `pmtiles` v3 protocol and `@protomaps/basemaps` Ukrainian (`uk`) dark theme. Ships a byte-verified regional archive `public/tiles/ukraine-overview.pmtiles` (`1.24 MB`, z0–z5, served with HTTP `206` Range + `immutable` CDN cache on Vercel), replaces unofficial Google dual-raster streams with official Esri World Imagery + Protomaps PMTiles GPU vector labels/boundaries, uses OpenFreeMap Dark (`z0–z14`) for Tactical vector mode, and supports optional self-hosted full-zoom `PMTILES_URL` / `VITE_PMTILES_URL`.
- **Autonomous CI, Deploy Sync & Keepalive:** `.github/workflows/ci-keepalive.yml` runs `npm run acceptance` on push/PR, auto-deploys Vercel Production with `VITE_RELEASE_SHA=${{ github.sha }}` (via `VERCEL_TOKEN` secret), waits for Render rollout (`RENDER_GIT_COMMIT`), verifies **24/24** live checks including HTTP `206` PMTiles Range serving and exact GitHub ↔ Render ↔ Vercel release SHA parity (`scripts/verify-production.mjs`), and runs 10-minute health + official alerts keepalive checks.

## Data Separation, Truthfulness & Zero-False-Precision Guarantees

1. **`official_alert` (`/api/alerts`)** — Official civil defense air-raid sirens (`alerts.in.ua` / `ubilling.net.ua` mirror) with explicit `dataCategory`, `status` (`"fresh" | "stale" | "unavailable"`), `source`, `sourceAvailable`, `lastConfirmedAt`, and `stale` flag. Loss of connection to the official source NEVER triggers a false all-clear ("відбій"): the backend (`AlertsInUaSource`) and client (`localStorage` cache + amber map/UI state) preserve the last confirmed alert state and exact confirmation timestamp while clearly indicating unknown/unupdated status.
2. **`osint_message` (`/api/osint/feed` & `/api/targets` where `dataCategory="osint_message"`)** — 14 live Ukrainian air-defense OSINT channels (`@kpszsu`, `@radar_raketaa`, `@mon1tor_ua`, `@monitor_ukr`, `@bpla_radar`, `@radar_zp`, `@monitor1654`, `@tlknewsua`, `@raketa_trevoga`, `@dnipro_alerts`, `@monitoringwar`, `@monitorwarr`, `@vanek_nikolaev`, `@war_monitor`).
   - Unknown altitude, speed, and heading remain `undefined` / `"Невідомо"`.
   - Coordinates display at ~2-decimal precision (`~49.99°N, ~36.23°E`) and spatial uncertainty never collapses below truthful settlement/corridor bounds (`≥3.5 km` OSINT, `≥2.5 km` eyewitness) across repeated Kalman cycles or checkpoint restores.
   - Minute-by-minute ETA is NEVER computed from unmeasured OSINT speeds.
   - Generic `"БпЛА"` messages are never silently upgraded to `"Shahed-136"`.
3. **`unverified_report` (`citizen-*`)** — Web `/api/report` and Telegram `/report` eyewitness submissions are explicitly classified as `sourceFamily="manual"` / `lifecycle="TENTATIVE"` (until corroborated by independent sensors), badged `НЕПЕРЕВІРЕНЕ ПОВІДОМЛЕННЯ (ОЧЕВИДЕЦЬ)`, separated in `LiveThreatDrawer`, capped at `confidence: 0.45`, excluded from automated Telegram push blasts, and carry zero fabricated speed/altitude/heading.
4. **`sensor_observation` (`/api/targets` where `dataCategory="sensor_observation"`)** — Physical military ADS-B/MLAT transponders gated through the single canonical `src/server/sources/adsbClassifier.ts` (non-overlapping feeds: `adsb.lol`, `adsb.fi` + `adsb.one`, `opensky.live`), NASA FIRMS VIIRS thermal hotspots, and Open-Meteo atmospheric wind vectors.

## Security, Validation & Automated Monitoring
- Unified runtime input/env validation via **Zod** (`src/server/validation/schemas.ts`) across `/api/report`, `/api/location`, `/api/alerts/subscribe`, `/api/ingest/osint`, `/api/ingest/sdr`, `/api/diagnostics/client`, `/api/replay`, `/api/osint/feed`, and `src/server/config/env.ts`.
- Structured JSON logging via **Pino** (`src/server/observability/logger.ts`) with automatic secret redaction and zero worker-thread overhead.
- Automated technical failure monitoring (`src/server/observability/failureMonitor.ts`) evaluates DB connectivity/latency, official alert feed outages, OSINT channel availability, RSS memory pressure, and uncaught runtime errors every 30 s, surfacing live status in `GET /health` (`monitoring`) and authenticated `GET /api/monitoring/incidents`, with optional free-tier webhook / Telegram admin alerting and 15-minute anti-spam cooldown.
- Admin/ingest endpoints (`GET /api/bot/diagnostic-lifecycle`, `GET /api/monitoring/incidents`, `POST /api/ingest/osint`, `POST /api/ingest/sdr`) require `INGEST_API_KEY` / `ADMIN_API_KEY` (`HTTP 401` unauthenticated).
- `POST /api/report` enforces Ukraine geographic bounds validation (`HTTP 400`), comment sanitization (240 chars max), and per-IP rate limiting (3 reports / 5 min, `HTTP 429`).
- HTTP body ceiling capped at `64 KB`; `X-Content-Type-Options: nosniff` and `Referrer-Policy` headers enforced on both Render and Vercel.

## Governance & Regression Protection
- **Agent Protocol (Codex & Antigravity):** [`AGENTS.md`](./AGENTS.md)
- **Mandatory Acceptance Criteria & Sign-Off:** [`ACCEPTANCE.md`](./ACCEPTANCE.md)
- **Local Pre-Deploy Gate:** `npm run acceptance` (`npm run scan:secrets` + `tsc --noEmit` + Vitest 33 suites / 144 tests + Vite & tsup builds)
- **Live Production Verification Gate:** `npm run verify:prod` (26 live checks across Render, Neon Postgres, Zod/Pino/FailureMonitor, Centralized Lifecycle & 30d Alert History, Protomaps PMTiles HTTP 206 Range serving, zero false precision, security guards, Vercel, and exact GitHub ↔ Render ↔ Vercel SHA parity)
