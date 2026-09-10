# Eye Radar — Project State & Architectural Baseline

**Last Updated:** 2026-09-10  
**Baseline Git Commit:** `6d46cba`  
**Deployment Status:**
- **Backend (Render):** `https://eye-radar.onrender.com/health` (Service ID: `srv-dagk9pgu01pc7388u35g`, Live, Healthy, Real Airborne Feeds Online, 145+ Active Tracks)
- **Frontend (Vercel):** `https://eye-radar.vercel.app` (Production, Live)
- **Telegram Bot:** `@EyeRadarUA_Bot` (Mini App embedded with cache-busting `?v=4.0.0&t=...`)

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

- **TypeScript Check:** `npm run check` — 0 errors.
- **Vitest Unit & Benchmark Test Suite:** `npm test` — 30 tests passing across 11 test suites:
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

---

## 3. Production Verification
- **Render Backend:** Live at `https://eye-radar.onrender.com/health` (145+ live tracks, healthy multi-source status, `/api/audit`, `/api/tracks`, `/api/tracks/:id/diagnostic`).
- **Vercel Frontend:** Live at `https://eye-radar.vercel.app` (React 19 Mini App with Live Timeline bar, Performance Tiers, and Track Inspector).
