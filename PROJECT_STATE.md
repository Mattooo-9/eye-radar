# Eye Radar — Project State & Architectural Baseline

**Production Topology:**
- **Frontend / Mini App / Proxies / Cron (Vercel):** `https://eye-radar.vercel.app`
- **Backend / Streaming / Fusion Worker (Render):** `https://eye-radar.onrender.com` (24/7 worker + `wss://eye-radar.onrender.com/ws`)
- **Database (Neon PostgreSQL):** Single source of truth for checkpoints (`radar_checkpoints`), persistent OSINT bulletins (`osint_bulletins`), historical track snapshots (`track_history_snapshots`), user preferences (`user_preferences`), 6-hour Telegram message deletion queue (`bot_message_deletion_queue`), and watchdog (`worker_watchdog`, `worker_locks`).
- **Telegram Bot:** `@AppEye_bot` (instant Mini App launch + `/report` eyewitness intake + 6-hour auto-deletion).
- **Autonomous CI & Keepalive:** `.github/workflows/ci-keepalive.yml` (`npm run acceptance` on push + 10-minute health ping).

## Data Separation & Truthfulness Architecture

1. **`official_alert` (`/api/alerts`)** — Official civil defense air-raid sirens from `alerts.in.ua`.
2. **`osint_message` (`/api/osint/feed` & `/api/targets` where `dataCategory="osint_message"`)** — 14 live Ukrainian air-defense OSINT channels (`@kpszsu`, `@radar_raketaa`, `@mon1tor_ua`, `@monitor_ukr`, `@bpla_radar`, `@radar_zp`, `@monitor1654`, `@tlknewsua`, `@raketa_trevoga`, `@dnipro_alerts`, `@monitoringwar`, `@monitorwarr`, `@vanek_nikolaev`, `@war_monitor`) + eyewitness reports. Unknown altitude/speed/heading remain explicitly unknown (`undefined` / `"Невідомо"`); no fabricated TTX, launch airbases, or unconfirmed hardware upgrades.
3. **`sensor_observation` (`/api/targets` where `dataCategory="sensor_observation"`)** — Physical military ADS-B/MLAT transponders gated through the single canonical `src/server/sources/adsbClassifier.ts` (4 non-overlapping aggregators: `adsb.lol`, `adsb.fi`, `adsb.one`, `opensky.live`), NASA FIRMS VIIRS thermal hotspots, and Open-Meteo atmospheric wind vectors.

## Governance & Quality Gates
- **Engineering rules for Codex & Antigravity:** [`AGENTS.md`](./AGENTS.md)
- **Mandatory acceptance criteria & sign-off:** [`ACCEPTANCE.md`](./ACCEPTANCE.md)
- **Automated local gate:** `npm run acceptance` (`tsc --noEmit` + Vitest 30 suites / 127 tests + Vite & tsup builds)
- **Automated live production gate:** `npm run verify:prod`
