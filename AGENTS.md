# AGENTS.md — Unified Engineering Protocol (Codex & Antigravity)

This repository (**Eye Radar**) is maintained jointly by autonomous coding agents (**Codex**, **Antigravity**) and human maintainers. Every agent modifying this codebase MUST follow this specification without exception.

---

## 1. Mission & Non-Negotiable Data Truthfulness Contract

Eye Radar is an autonomous civil air-defense awareness system for Ukraine (Web App + Telegram Mini App `@AppEye_bot`).

1. **Zero Synthetic Data in Production**
   - `NODE_ENV=production` strictly rejects any observation where `isSynthetic === true` or `source === "simulation"`.
   - No synthetic generators, mock/dummy payloads, or drill simulators may be active in production endpoints or UI.
2. **Zero Fabricated Parameters / Zero False Precision**
   - Unknown parameters MUST remain unknown (`undefined` / `null` on backend, `"Невідомо"` in UI).
   - Never fabricate default altitudes (e.g., `180 m`, `350 m`, `9800 m`), measured speeds, headings (`0°`), launch airbases, military brigades, warhead weights, or sensor-detection claims for textual OSINT messages.
   - Never silently upgrade generic `"БпЛА"` text alerts to `"Shahed-136"` or `"Shahed-238 (Jet)"` unless explicitly named in the source message or physically corroborated.
3. **Strict 3-Way Data Separation (`DataCategory`)**
   - `official_alert` — Official civil defense air-raid sirens (`alerts.in.ua`, `/api/alerts`).
   - `osint_message` — Textual air-defense monitoring reports (14 Ukrainian OSINT channels, eyewitness reports, `/api/osint/feed` & `/api/targets` where `dataCategory === "osint_message"`). Carries explicit source, publish timestamp, original snippet, and spatial uncertainty radius (`±X km`).
   - `sensor_observation` — Direct physical telemetry (`adsb.lol`, `adsb.fi`, `adsb.one`, `opensky.live`, NASA FIRMS VIIRS thermal, Open-Meteo wind; `/api/targets` where `dataCategory === "sensor_observation"`). Only physically measured fields are displayed as measured.
4. **Freshness & Zero European Civil Airliner Clutter**
   - Observations older than 25 s are rejected on ingest; stale tracks prune automatically after 45 s without updates (manual eyewitness reports: 5 min).
   - All ADS-B ingestion passes through the single canonical gate `src/server/sources/adsbClassifier.ts` (`shouldIngestAdsbContact`), which blocks commercial European airliners and enforces the exact Ukraine border polygon (`UKRAINE_BORDER_POLYGON`) + 350 km military theater boundary.

---

## 2. Canonical Architecture & Module Ownership

### Backend (`src/server/`)
- **Entry & HTTP/WS Server**: `src/server/index.ts` (single canonical `/api/targets`, `/api/osint/feed`, `/api/alerts`, `/api/impacts`, `/api/replay`, `/api/tracks/:id/diagnostic`, `/health`, `/ws`).
- **Domain Types & Geometry**:
  - `src/server/domain/types.ts` — Canonical `TrackState`, `Observation`, `DataCategory`, `CompactTrackPacket`.
  - `src/server/domain/geo.ts` — `UKRAINE_BORDER_POLYGON`, `isPointInPolygon`, `getDistanceToUkraineBorderKm`, haversine/bearing math.
- **Core Fusion & Classification**:
  - `src/server/core/trackManager.ts` — Single track state store, IMM Kalman filter (`immFilter.ts`), correlation (`trackCorrelator.ts`), source-aware lifecycle (`CONFIRMED → COASTING → STALE`), expiry/pruning, checkpoint restore.
  - `src/server/core/classificationEngine.ts` — Evidence-gated classification with bounded, deduplicated `evidence` / `classEvidence` / `threatEvidence` (max 24 entries).
  - `src/server/core/impactManager.ts` — Verified empirical impact & air-defense interception log.
  - `src/server/core/uncertaintyEventManager.ts` — Non-positional / thermal / wide-uncertainty events (NASA FIRMS).
  - `src/server/core/aiBriefing.ts` — Truthful situational summary respecting `dataCategory` and unknown fields.
- **Data Sources (`src/server/sources/`) — Non-Overlapping Ownership**:
  - `adsbClassifier.ts` — Single Source of Truth for military/civil/helicopter classification & Ukraine theater gate.
  - `openskyAdsbLol.ts` — Owns `api.adsb.lol` endpoints exclusively.
  - `airplanesLive.ts` — Owns `opendata.adsb.fi` + `api.adsb.one` military endpoints exclusively.
  - `openskyLive.ts` — Owns `opensky-network.org` exclusively.
  - `publicOsintFeed.ts` + `src/server/ingest/osintParser.ts` + `ukraineGeo.ts` — 14 Ukrainian OSINT channels, homoglyph deobfuscation, Ukrainian locative morphology, 315+ geo-nodes, impact/interception extraction, promo footer stripping.
  - `alertsInUa.ts` — Official air-raid sirens (`alerts.in.ua`).
  - `firmsThermal.ts` — NASA FIRMS VIIRS thermal anomalies.
  - `openMeteoWind.ts` — Atmospheric wind vectors.
- **Database & Autonomous Persistence (`src/server/db/`)**:
  - `pool.ts` + `schema.ts` — Neon PostgreSQL connection & idempotent DDL migrations.
  - `checkpointService.ts` — Atomic track checkpoints (`radar_checkpoints`) + local fallback.
  - `intelligenceStore.ts` — Persistent OSINT bulletins (`osint_bulletins`, 24 h retention) & track snapshots (`track_history_snapshots`, 2 h retention) for zero-blind-spot reboots and `/api/replay`.
  - `watchdogService.ts` — Distributed heartbeat (`worker_watchdog`) & locks (`worker_locks`).
- **Telegram Bot (`src/server/bot/`)**:
  - `telegramBot.ts` + `messageDeletionService.ts` — `@AppEye_bot` + Neon Postgres 6-hour auto-deletion queue.

### Frontend (`src/client/`)
- **State & Transport**: `src/client/hooks/useWsRadar.ts`, `src/client/workers/radarWorker.ts`, `src/client/lib/trackStore.ts`, `src/client/types.ts`.
- **Map & Minimalist Tactical HUD**:
  - `src/client/components/MapView.tsx` — MapLibre GL JS dark/satellite/NVG/FLIR canvas renderer with truthful callouts.
  - `src/client/components/TacticalTopBar.tsx` — Compact top header (`EYE RADAR`, WS status, oblast alert pill, `РАПОРТ`, `ОПЦІЇ`).
  - `src/client/components/LiveThreatDrawer.tsx` — Collapsible bottom-left dock separating `Повідомлення ППО / OSINT` and `Спостереження ADS-B`.
  - `src/client/components/TargetCard.tsx` + `src/client/lib/targetSpecs.ts` — Minimalist factual telemetry card (unknown stays `Невідомо`, live source quote, on-demand `TrackInspectorModal`).
  - `src/client/components/TacticalMenuModal.tsx` — Filters, map vision/layers, cities, impacts, live telemetry & OSINT stream (`Інтел`).
  - `src/client/components/LocationCard.tsx`, `LocationSetupModal.tsx`, `CitizenReportModal.tsx`, `AiBriefingModal.tsx`, `ImpactCard.tsx`, `LiveTimelineBar.tsx`.

### Production Topology
- **Backend / WebSocket Worker**: Render (`https://eye-radar.onrender.com`, auto-deploys from GitHub `main`).
- **Frontend / Serverless Proxies / Cron**: Vercel (`https://eye-radar.vercel.app`, `vercel.json` proxies `/api/*` & `/health` to Render; cron in `api/cron/cleanup-messages.ts`).
- **Database**: Neon PostgreSQL (`DATABASE_URL`).
- **Autonomous CI & Keepalive**: `.github/workflows/ci-keepalive.yml` (pings production every 10 min; runs `npm run acceptance` on every push to `main`).

---

## 3. Mandatory Change & Deployment Workflow (Codex & Antigravity)

1. **Before Editing**: Read existing modules before changing; never introduce duplicate classifiers, parallel endpoints, or unreferenced components.
2. **Mandatory Local Gate (Must Exit 0)**:
   ```bash
   npm run acceptance
   ```
   This executes `tsc --noEmit` → `vitest run` (including `src/test/acceptance.test.ts`) → `vite build` + `tsup`.
3. **Commit & Push**: Small, atomic, reversible commits on `main` (zero untracked temp scripts or screenshots).
4. **Production Deployment**:
   - Push to `origin/main` triggers Render backend deployment.
   - Ensure Vercel frontend is updated to match the exact commit (via Vercel Git integration or `vercel --prod`).
5. **Mandatory Post-Deploy Verification**:
   ```bash
   npm run verify:prod
   ```
   Verifies live Render `/health`, `/api/targets`, `/api/osint/feed`, Vercel `/app`, 0 synthetic tracks, 0 EU civil airliners, strict category tagging, and graceful 404/empty handling.
6. **Rollback Procedure**:
   - Backend (Render): `git revert <bad_commit> && git push origin main` (or Render dashboard instant rollback to previous deploy).
   - Frontend (Vercel): `vercel rollback` or re-alias previous ready deployment URL.
   - Database (Neon): DDL migrations in `src/server/db/schema.ts` are strictly additive (`CREATE TABLE IF NOT EXISTS`), ensuring backward compatibility on rollback.

---

## 4. Acceptance Lock Rule

No new feature expansion is permitted unless **every criterion** in [`ACCEPTANCE.md`](./ACCEPTANCE.md) holds status **`PASS`** with verifiable evidence.
