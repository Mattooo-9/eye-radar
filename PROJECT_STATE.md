# Eye Radar — Project State & Architectural Baseline

**Last Updated:** 2026-09-10  
**Baseline Git Commit:** `5f64e3f`  
**Deployment Status:**
- **Backend (Render):** `https://eye-radar.onrender.com/health` (Service ID: `srv-dagk9pgu01pc7388u35g`, Live, Healthy, 7 Sources Online, 240+ Active Tracks)
- **Frontend (Vercel):** `https://eye-radar.vercel.app` (Production, Live)
- **Telegram Bot:** `@EyeRadarUA_Bot` (Mini App embedded with cache-busting `?v=3.5.0&t=...`)

---

## 1. Verified Working Components

### 1.1 Client (Frontend / Telegram Mini App)
- **Stack:** Vite 7, React 19, TypeScript, Tailwind CSS, Lucide React, MapLibre GL 5.15.
- **Rendering Engine:** Hybrid WebGL (MapLibre vector/satellite layers + GPU symbol sprites) + 60fps Canvas HUD overlay.
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
  - **💥 Impacts (Прильоти):** TTL = 60 min with progressive alpha decay from 1.0 to 0.3.
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
- **Source Health Engine (`src/server/sources/sourceHealth.ts`):**
  - Real-time $p_{50}, p_{95}, p_{99}$ latency tracking across all feeds (ADSB.lol, OpenSky, Airplanes.live, Alerts.in.ua, Open-Meteo, NASA FIRMS, Local SDR).
  - Dynamic reliability weighting multiplier.
- **Track Lifecycle Management (`src/server/core/trackManager.ts`):**
  - States: `TENTATIVE` → `CONFIRMED` → `COASTING` → `STALE` → `EXPIRED`.
  - Zero object spread during tick mutation for maximum V8 throughput.
- **Telegram Bot (`src/server/bot/telegramBot.ts`):**
  - Mini App launcher button, `/start`, `/status`, `/subscribe` for alerts with user coordinates and customizable danger radius.

---

## 2. Test & Quality Metrics

- **TypeScript Check:** `npm run check` — 0 errors.
- **Vitest Unit & Benchmark Test Suite:** `npm test` — 20 tests passing across 8 test suites:
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
- Render Backend: Live at `https://eye-radar.onrender.com/health` (240+ live tracks, 7 sources online with $p_{50}/p_{95}/p_{99}$ metrics).
- Vercel Frontend: Live at `https://eye-radar.vercel.app`.
