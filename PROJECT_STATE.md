# Eye Radar — Project State & Architectural Baseline

**Last Updated:** 2026-09-10  
**Baseline Git Commit:** `644fb87`  
**Deployment Status:**
- **Backend (Render):** `https://eye-radar.onrender.com/health` (Service ID: `srv-dagk9pgu01pc7388u35g`, Live, Healthy)
- **Frontend (Vercel):** `https://eye-radar.vercel.app` (Production, Live)
- **Telegram Bot:** `@EyeRadarUA_Bot` (Mini App embedded with cache-busting `?v=3.5.0&t=...`)

---

## 1. Verified Working Components

### 1.1 Client (Frontend / Telegram Mini App)
- **Stack:** Vite 6, React 19, TypeScript, Tailwind CSS, Lucide React, MapLibre GL 5.15.
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
- **Mobile Telegram Mini App Adaptation:**
  - Safe-area insets (`safeAreaInset`, `contentSafeAreaInset`, `viewportStableHeight`).
  - Strict no-overflow layout (320px–430px responsive mobile screens, no button clipping).

### 1.2 Server & Real-Time Pipeline
- **Stack:** Node.js, Express, `ws` WebSocket server, TypeScript.
- **Track Management (`src/server/core/trackManager.ts`):**
  - High-frequency spatial extrapolator using geodesic `destinationPoint()`.
  - Zero object spread during tick mutation for maximum V8 throughput.
  - Compact packet serialization `[id, type, lat, lon, heading, speed, timestamp, confidence, uncertaintyRadius, threatLevel, altitude, model, callsign]`.
- **Filtering & Kinematics (`src/server/core/kalman.ts`):**
  - 1D/2D Kalman filters for position, heading, and velocity smoothing with minimal lag.
- **Threat Engine (`src/server/core/threatEngine.ts`):**
  - Automated civilian threat classification (CRITICAL, HIGH, MEDIUM, LOW) based on proximity, speed, heading towards population centers, and weapon class.
- **Telegram Bot (`src/server/bot/telegramBot.ts`):**
  - Mini App launcher button, `/start`, `/status`, `/subscribe` for alerts.

---

## 2. Test & Quality Metrics

- **TypeScript Check:** `npm run check` — 0 errors.
- **Vitest Unit Test Suite:** `npm test` — 15 tests passing across 6 test suites:
  - `threatEngine.test.ts` (Threat scoring & zone proximity)
  - `locationIntel.test.ts` (Oblast/raion geocoding & danger zones)
  - `osintParser.test.ts` (Cascade OSINT regex & message parsing)
  - `kalman.test.ts` (Kalman state estimation & convergence)
  - `pipeline.test.ts` (End-to-end ingestion and track output)
  - `trackCorrelator.test.ts` (Track association and spatial gating)

---

## 3. Autonomous Upgrade Roadmap (Zero Regression)

1. **Layer 1 — Unified Observation Schema & Multi-Source Ingestion:**
   - Standard 20-field evidence-based observation schema.
   - Live adapters: OpenSky Network API, ADSB.lol, local receiver JSON stream (`readsb`/`dump1090`), Alerts.in.ua, Open-Meteo wind verification, OSINT cascade deduplication.
2. **Layer 2 — Multi-Target Data Fusion & IMM Filter:**
   - Interacting Multiple Model (IMM) filter (Constant Velocity + Coordinated Turn models).
   - Track Lifecycle: `TENTATIVE` → `CONFIRMED` → `COASTING` → `STALE` → `EXPIRED`.
   - Mahalanobis distance gating to prevent false track merging.
3. **Layer 3 — Target Classification & Measured vs. Estimated Telemetry:**
   - Explicit separation of measured telemetry vs. model-derived estimates.
   - Dynamic uncertainty radius ($\sigma$) based on sensor coverage.
4. **Layer 4 — Source Health Engine:**
   - Latency percentiles ($p_{50}, p_{95}, p_{99}$), packet drop rates, dynamic weight adjustment.
5. **Layer 5 — Events & Decay TTL:**
   - Impacts TTL = 60 min (with decaying visual opacity/intensity).
   - Interceptions TTL = 10 min (with success confirmation badge).
6. **Layer 6 — Telegram Mini App User Location & Mobile Performance:**
   - Geolocation auto-request with permission fallback, settlement search, return-to-location.
   - Throttled Canvas rendering (30/60 FPS adaptive) for low-end mobile devices.
7. **Layer 7 — Automated Replay & Synthetic Benchmark Test Suite:**
   - Replay test suite (`replay.test.ts`) covering delayed packets, splits, false merges.
   - Synthetic benchmark (`syntheticBenchmark.test.ts`) validating position error $\le 350$ m and classification accuracy $\ge 98\%$.
8. **Layer 8 — Production Deployment:**
   - Git push to `main`, auto-deploy to Render and Vercel, production health check.
