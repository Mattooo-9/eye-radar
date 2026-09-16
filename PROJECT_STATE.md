# Eye Radar — Project State & Architectural Baseline

**Last Updated:** 2026-09-16  
**Baseline Git Commit:** `6fdfff3`  
**Active Production Topology:**
- **Frontend / Mini App / Webhook / Cron (Vercel):** `https://eye-radar.vercel.app` (Production Live)
  - Vercel Serverless: Telegram Webhook (`/api/telegram/webhook`), 6-hour Auto-Deletion Cron (`/api/cron/cleanup-messages`), API proxies.
- **Persistent State / Queues / Checkpoints (Neon Postgres):** `ep-rough-cloud-av1jwroi-pooler.c-11.us-east-1.aws.neon.tech/neondb` (PostgreSQL 18.6 AWS US-East-1, Single Source of Truth).
  - Checkpoints: `radar_checkpoints` (monotonic sequence, atomic IMM state restoration).
  - 6-Hour Message Deletion Queue: `bot_message_deletion_queue` (`FOR UPDATE SKIP LOCKED`).
  - User Preferences: `user_preferences` (location, alert radius, notification state).
  - Watchdog & Locks: `worker_watchdog` (4s heartbeat, status `healthy`), `worker_locks` (distributed lease locks).
- **Backend Worker / Streaming (Render):** `https://eye-radar.onrender.com` (Service ID: `srv-dagk9pgu01pc7388u35g`, 24/7 dedicated worker).
  - Continuous ingestion (`airplanes.live`, `adsb.lol`, `alerts.in.ua`, `open-meteo`).
  - IMM Kalman filter fusion, threat engine, and high-performance binary WebSocket (`wss://eye-radar.onrender.com/ws`).
  - Auto-restores tracks and sequence from Neon Postgres checkpoints on reboot.
- **Future Migration Target (Railway):** `INACTIVE (deployment on hold due to expired trial)`.
  - Configuration preserved in `railway.json`, `Procfile`, and `Dockerfile`.
- **Telegram Bot:** `@AppEye_bot` (Auto-deletion queue via Neon Postgres, immediate Mini App launch).

---

## 1. Verified Working Components

### 1.1 Client (Frontend / Telegram Mini App)
- **Stack:** Vite 7, React 19, TypeScript, Tailwind CSS, Lucide React, MapLibre GL 5.15.
- **Rendering Engine:** Hybrid WebGL (MapLibre vector/satellite layers + GPU symbol sprites) + 60fps / 30fps adaptive Canvas HUD overlay.
- **Performance Tiers (`LOW`, `NORMAL`, `HIGH`):**
  - Auto-detected on devices with `hardwareConcurrency < 4` or selectable via UI badge.
  - `LOW` tier throttles render loop to 30 FPS, disables heavy canvas shadow filters, and uses aggressive viewport culling for smooth 60Hz UI on low-end mobile devices.
- **Interactive LIVE Timeline Bar (`src/client/components/LiveTimelineBar.tsx`):**
  - Modes: `● LIVE` (0s), `-1 хв` (60s), `-5 хв` (300s), `-10 хв` (600s), `-30 хв` (1800s), `-60 хв` (3600s).
  - Historical playback banner with one-tap return to live stream.
  - Historical position interpolation utilizing measured telemetry history.
- **Target Kinematic States (Visual Separation on Map):**
  - **MEASURED:** Amber waypoint dots for actual sensor hits from source feeds.
  - **ESTIMATED:** IMM Kalman smoothed real-time position with directional tactical chevron.
  - **PREDICTED:** Dashed future trajectory flight vector pointing to extrapolated destination.
  - **UNCERTAINTY:** Semi-transparent 1-sigma covariance ellipse ($\sigma$) reflecting sensor accuracy and elapsed coasting time.
- **Track Inspector & Diagnostics Modal (`src/client/components/TrackInspectorModal.tsx`):**
  - One-tap tactical diagnostic dialog accessible from `TargetCard` ("🔬 Діагностика (Provenance)").
  - Displays complete provenance chain, measured vs estimated coordinates/speed/altitude deltas in meters, IMM mode probabilities ($\mu_{CV}, \mu_{CT}$), and Mahalanobis gating score.
- **Tactical Silhouettes & TTX:**
  - Strict physics separation:
    - **Shahed-136:** MD-550 piston engine (140–195 km/h, pusher propeller, low altitude 50–350 m, graphite delta).
    - **Shahed-238:** Toloue-10 / TJ100 turbojet (450–600 km/h, glowing exhaust plume, RAM stealth black finish, altitude 200–2500 m).
    - **Recon UAVs:** Supercam S350 / Orlan-10 / ZALA 421-16E (60–120 km/h, optical sensor turret).
    - **Cruise Missiles:** Kh-101 / Kalibr (680–850 km/h, terrain hugging, fold-out wings).
    - **Aviation & Rotary:** Su-34/Su-35 / MiG-31K / Ka-52 / Mi-8.
    - **Precision Guided Bombs:** KAB-500/1500 with UMPK glide kits.
    - **FPV Strike Drones:** Quadcopter layout with tactical RPG warheads.
- **Cartography:**
  - Real internationally recognized borders of Ukraine.
  - No duplicated borders, no synthetic river borders, no country text labels.
  - Clean Google Satellite tiles with automatic overscaling (no "Zoom level not supported" watermarks).
- **Event Visualization & TTLs:**
  - **💥 Impacts (Прильоти):** TTL = 60 min with progressive alpha decay from 1.0 to 0.25.
  - **🛡️ Interceptions (Збиття):** TTL = 10 min with progressive alpha decay.
- **Mobile Telegram Mini App Adaptation:**
  - Safe-area insets (`safeAreaInset`, `contentSafeAreaInset`, `viewportStableHeight`).
  - Strict no-overflow layout (320px–430px responsive mobile screens, no button clipping).

### 1.2 Server & Real-Time Pipeline
- **Unified Observation Schema (`src/server/domain/unifiedObservation.ts`):**
  - Standard 20-field schema: source ID, source family, event ID, timestamps (observed/published/received/processed), coordinates, speed, heading, vertical rate, measurement accuracy ($\sigma$), source quality, confidence, covariance, evidence, provenance.
- **Interacting Multiple Model (IMM) Filter (`src/server/core/immFilter.ts`):**
  - Blends Constant Velocity (CV) and Coordinated Turn (CT) kinematic models with dynamic mode probabilities $\mu_{CV}, \mu_{CT}$.
- **Evidence-based Target Classification Engine (`src/server/core/classificationEngine.ts`):**
  - Physics-based separation of Shahed-238 (turbojet) vs Shahed-136 (piston), recon UAVs, cruise missiles, KABs, FPVs.
  - Distinguishes measured speed/altitude vs model-derived estimates.
- **Automated Source Health & Audit Engine (`src/server/sources/sourceHealth.ts`):**
  - Tracks lifecycle states: `LIVE`, `DEGRADED`, `STALE`, `OFFLINE`.
  - Strict isolation: a source is ONLY marked `LIVE` after a successful parse in the current session.
  - Real-time $p_{50}, p_{95}, p_{99}$ latency tracking across feeds (ADSB.lol, OpenSky, Airplanes.live, Alerts.in.ua, Open-Meteo, NASA FIRMS, Local SDR, Public OSINT).
  - Update frequency calculation (Hz) and `activeTracksHelped` counter.
  - Dynamic reliability weighting multiplier.
- **Track Manager & Diagnostics (`src/server/core/trackManager.ts`):**
  - States: `TENTATIVE` → `CONFIRMED` → `COASTING` → `STALE` → `EXPIRED`.
  - Maintains `provenanceChain`, `measuredHistory` ring buffers, and delta sequence tracking.
  - `GET /api/tracks/:id/diagnostic`: delivers instant, comprehensive telemetry diagnostic report.
- **Synthetic Isolation:**
  - Synthetic simulation is disabled by default in production (`simulationEnabled = false`).
  - Real airborne tracks originate strictly from authorized live feeds.
- **Telegram Bot (`src/server/bot/telegramBot.ts`):**
  - Mini App launcher button, `/start`, `/status`, `/subscribe` for alerts with user coordinates and customizable danger radius.

---

## 2. Test & Quality Metrics

- **TypeScript Check:** `npm run check` — 0 errors (`tsc --noEmit`).
- **Vitest Unit & Benchmark Test Suite:** `npm test` — **71 tests passing across 21 test suites**:
  - `checkpointAndWatchdog.test.ts` (Neon Postgres atomic checkpoints, IMM Kalman state restoration, watchdog heartbeats, lease locking, event deduplication)
  - `messageDeletionService.test.ts` (6-hour bot message auto-deletion queue with `FOR UPDATE SKIP LOCKED`, rate limiting, retry backoff)
  - `protocolBenchmark.test.ts` (Compact binary radar protocol encoding/decoding benchmarks, payload reduction >75%)
  - `capabilityMatrix.test.ts` (Source capability matrix, positional feed isolation, contextual alerting segregation)
  - `locationLogic.test.ts` (Location setup onboarding, region geocoding, localStorage confirmation, prevention of accidental map click mutation)
  - `classificationAlternative.test.ts` (Shahed-136 vs Shahed-238 probabilistic classification, nearest alternative, hysteresis, UNKNOWN fallback)
  - `crossingTracks.test.ts` (Crossing tracks heading separation, speed gating, track reacquisition in COASTING state)
  - `sourceHealth.test.ts` (Source lifecycle OFFLINE -> LIVE, p50/p95/p99 latency calculations, error degradation, active tracks helped)
  - `sourceAudit.test.ts` (Automated source audit, lifecycle transitions, p50/p95/p99 latency, tracks helped)
  - `provenance.test.ts` (Provenance chain tracking, measured vs estimated telemetry, track diagnostics, synthetic isolation)
  - `websocketDelta.test.ts` (Sequence number monotonicity, removed ID pruning, 13-element compact packet schema)
  - `threatEngine.test.ts` (Threat scoring & zone proximity)
  - `locationIntel.test.ts` (Oblast/raion geocoding & danger zones)
  - `osintParser.test.ts` (Cascade OSINT regex & message parsing)
  - `kalman.test.ts` (Kalman state estimation & convergence)
  - `correlator.test.ts` (Track correlation & Mahalanobis distance gating)
  - `pipeline.test.ts` (End-to-end ingestion and track output)
  - `replay.test.ts` (Replay robustness: delayed packets, crossing tracks, 60m/10m event TTLs)
  - `syntheticBenchmark.test.ts` (IMM position error $\le 350$m, 100% classification accuracy)
  - `backendAiEngine.test.ts` (Multi-source threat briefing generator & NLP parser)
  - `spatialIndex.test.ts` (RBush 2D spatial indexing for fast spatial bounding queries)

---

## 3. Production Verification
- **Render Backend Worker:** Live at `https://eye-radar.onrender.com/health` (`database.ok: true`, `watchdog.ok: true`, monotonic `sequenceId`, live positional feeds `airplanes.live`, `adsb.lol`).
- **Neon Postgres:** Live at `ep-rough-cloud-av1jwroi-pooler.c-11.us-east-1.aws.neon.tech/neondb` (PostgreSQL 18.6, single source of truth for checkpoints, watchdog, 6h queues, user preferences).
- **Vercel Mini App:** Live at `https://eye-radar.vercel.app` (React 19 Mini App, `/api/cron/cleanup-messages` 200 OK, `/api/telegram/webhook` 200 OK).
- **Railway:** `INACTIVE (deployment on hold due to expired trial)` — migration target files maintained in repo.


