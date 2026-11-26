# Eye Radar — Project State & Architectural Baseline

**Status:** Stable Production Baseline (Control Audit Passed)  
**Production Topology:**
- **Frontend / Mini App / Proxies / Cron (Vercel):** `https://eye-radar.vercel.app`
- **Backend / Streaming / Fusion Worker (Render):** `https://eye-radar.onrender.com` (24/7 worker + `wss://eye-radar.onrender.com/ws`)
- **Database (Neon PostgreSQL):** Single source of truth for checkpoints (`radar_checkpoints`), persistent OSINT bulletins (`osint_bulletins`, 24 h retention), historical track snapshots (`track_history_snapshots`, 2 h retention), user preferences (`user_preferences`), 6-hour Telegram message deletion queue (`bot_message_deletion_queue`), and watchdog (`worker_watchdog`, `worker_locks`).
- **Telegram Bot:** `@AppEye_bot` (Mini App launch, `/alerts` live oblast readout, `/report` unverified eyewitness intake, truthful proximity notifications, 6-hour auto-deletion).
- **Autonomous CI & Keepalive:** `.github/workflows/ci-keepalive.yml` (`npm run acceptance` on push + 10-minute health ping; hazardous scheduled force-push workflow removed).

## Data Separation, Truthfulness & Zero-False-Precision Guarantees

1. **`official_alert` (`/api/alerts`)** — Official civil defense air-raid sirens (`alerts.in.ua` / `ubilling.net.ua` mirror) with explicit `dataCategory`, `source`, `updatedAt`, and `stale` flag; alerts expire automatically after 3 minutes of upstream outage so stale sirens are never shown as active.
2. **`osint_message` (`/api/osint/feed` & `/api/targets` where `dataCategory="osint_message"`)** — 14 live Ukrainian air-defense OSINT channels (`@kpszsu`, `@radar_raketaa`, `@mon1tor_ua`, `@monitor_ukr`, `@bpla_radar`, `@radar_zp`, `@monitor1654`, `@tlknewsua`, `@raketa_trevoga`, `@dnipro_alerts`, `@monitoringwar`, `@monitorwarr`, `@vanek_nikolaev`, `@war_monitor`).
   - Unknown altitude, speed, and heading remain `undefined` / `"Невідомо"`.
   - Coordinates display at ~2-decimal precision (`~49.99°N, ~36.23°E`) and spatial uncertainty never collapses below truthful settlement/corridor bounds (`≥3.5 km` OSINT, `≥2.5 km` eyewitness) across repeated Kalman cycles or checkpoint restores.
   - Minute-by-minute ETA is NEVER computed from unmeasured OSINT speeds.
   - Generic `"БпЛА"` messages are never silently upgraded to `"Shahed-136"`.
3. **`unverified_report` (`citizen-*`)** — Web `/api/report` and Telegram `/report` eyewitness submissions are explicitly classified as `sourceFamily="manual"` / `lifecycle="TENTATIVE"` (until corroborated by independent sensors), badged `НЕПЕРЕВІРЕНЕ ПОВІДОМЛЕННЯ (ОЧЕВИДЕЦЬ)`, separated in `LiveThreatDrawer`, capped at `confidence: 0.45`, excluded from automated Telegram push blasts, and carry zero fabricated speed/altitude/heading.
4. **`sensor_observation` (`/api/targets` where `dataCategory="sensor_observation"`)** — Physical military ADS-B/MLAT transponders gated through the single canonical `src/server/sources/adsbClassifier.ts` (non-overlapping feeds: `adsb.lol`, `adsb.fi` + `adsb.one`, `opensky.live`), NASA FIRMS VIIRS thermal hotspots, and Open-Meteo atmospheric wind vectors.

## Security & Abuse Controls
- Admin/ingest endpoints (`GET /api/bot/diagnostic-lifecycle`, `POST /api/ingest/osint`, `POST /api/ingest/sdr`) require `INGEST_API_KEY` / `ADMIN_API_KEY` (`HTTP 401` unauthenticated).
- `POST /api/report` enforces Ukraine geographic bounds validation (`HTTP 400`), comment sanitization (240 chars max), and per-IP rate limiting (3 reports / 5 min, `HTTP 429`).
- HTTP body ceiling capped at `64 KB`; `X-Content-Type-Options: nosniff` and `Referrer-Policy` headers enforced on both Render and Vercel.

## Governance & Regression Protection
- **Agent Protocol (Codex & Antigravity):** [`AGENTS.md`](./AGENTS.md)
- **Mandatory Acceptance Criteria & Sign-Off:** [`ACCEPTANCE.md`](./ACCEPTANCE.md)
- **Local Pre-Deploy Gate:** `npm run acceptance` (`tsc --noEmit` + Vitest 30 suites / 129 tests + Vite & tsup builds)
- **Live Production Verification Gate:** `npm run verify:prod` (20 live checks across Render, Neon Postgres, zero false precision, security guards, and Vercel)
