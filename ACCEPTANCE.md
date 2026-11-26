# EYE RADAR — Mandatory Acceptance Criteria (`ACCEPTANCE.md`)

> Feature expansion is prohibited while ANY criterion below is `FAIL` or unverified.
> An unverified criterion is treated as `FAIL`.

---

## Automated Verification Commands

| Gate | Command | Scope |
|---|---|---|
| Local Pre-Deploy Acceptance | `npm run acceptance` | TypeScript (`tsc --noEmit`), full Vitest suite incl. `src/test/acceptance.test.ts`, Vite client + tsup server build |
| Live Production Verification | `npm run verify:prod` | Live Render (`/health`, `/api/targets`, `/api/osint/feed`, `/api/eo/change-detection`, 404 check) + Vercel (`/app`, `/api/targets`, `/api/osint/feed`) |
| Autonomous CI & Keepalive | `.github/workflows/ci-keepalive.yml` | Runs `npm run acceptance` on every push to `main` and pings live health every 10 minutes |

---

## Mandatory Criteria Specification

### 1. Достоверность данных (Data Truthfulness)
- **1.1** `0` синтетических объектов и фиктивных параметров в production (`isSynthetic === false`, synthetic observations rejected when `NODE_ENV=production`).
- **1.2** `100%` отображаемых сведений имеют источник (`sources` / `callsign` / `provenanceChain`) и время получения (`timestamp` / `observedAt`).
- **1.3** Неизвестные характеристики (`altitude`, `measuredSpeed`, `measuredHeading` для текстовых OSINT-сообщений) остаются `undefined` / `null` в данных и отображаются как `Невідомо` в UI. Запрещены шаблонные аэродромы, выдуманные военные подразделения и навязанные модели (`БпЛА` не апгрейдится в `Shahed-136` без указания в тексте).
- **1.4** Официальные тревоги (`official_alert` / `/api/alerts`), текстовые сообщения (`osint_message` / `/api/osint/feed` & `dataCategory="osint_message"`) и фактические наблюдения сенсоров (`sensor_observation` / ADS-B & FIRMS) строго разделены в модели данных, API и UI.
- **1.5** Устаревшая информация не отображается как актуальная (отброс наблюдений старше 25 с, очистка треков через 45 с без обновления, истечение бюллетеней по `maxAgeMs`, отказ от восстановления протухших/деградированных чекпоинтов).

### 2. Архитектура (Architecture)
- **2.1** Единая модель данных (`TrackState` + `DataCategory`, `UnifiedObservation`) и единый источник истины для ADS-B классификации (`src/server/sources/adsbClassifier.ts`).
- **2.2** Отсутствие дублирующих маршрутов (`/api/targets` ровно один), дублирующих опросов одних и тех же ADS-B URL и неиспользуемых мёртвых модулей.
- **2.3** Чёткое распределение ответственности между `sources`, `ingest`, `core`, `db`, `bot`, `client`.
- **2.4** Сохранение работоспособности существующих интеграций (Neon PostgreSQL, Render, Vercel, `@AppEye_bot`, `alerts.in.ua`, 14 каналов ППО, 4 военных ADS-B агрегатора, NASA FIRMS, Open-Meteo).

### 3. Интерфейс (Interface)
- **3.1** Единый профессиональный минималистичный визуальный стиль без декоративного мусора и выдуманных ТТХ.
- **3.2** Отсутствие наложений подписей, кнопок и шкалы карты (`◎ МОЯ ЛОКАЦІЯ`, `100 km`, `LiveThreatDrawer`, таймлайн, вкладки меню).
- **3.3** Корректное отображение на десктопе (`1280×800`) и мобильном экране (`375×812` Telegram Mini App).
- **3.4** Все видимые элементы управления функциональны.
- **3.5** Дополнительная техническая диагностика (`TrackInspectorModal` / Provenance) раскрывается по запросу.

### 4. Производительность (Performance & Cleanliness)
- **4.1** `0` ошибок TypeScript (`tsc --noEmit`), сборки (`vite build` + `tsup`) и консоли браузера.
- **4.2** `100%` обязательных тестов проходят (`vitest run`).
- **4.3** Отсутствие утечек памяти (ограниченные дедуплицированные массивы `evidence` ≤ 24, стабильный RSS < 150 MB) и `0` зависших фоновых процессов.
- **4.4** Компактный сетевой трафик (`/api/targets` < 100 KB, gzip client bundle < 70 KB).

### 5. Автономность (Autonomy & Resiliency)
- **5.1** Автоматическое восстановление после сбоев и перезапусков (`radar_checkpoints` + `osint_bulletins` hydration из Neon Postgres).
- **5.2** Корректная обработка недоступности источников и отсутствия данных (0 падений, 0 подмены фейками).
- **5.3** Автоматическая очистка устаревших записей (БД retention: `osint_bulletins` 24 ч, `track_history_snapshots` 2 ч, автоудаление сообщений бота 6 ч).
- **5.4** Проверенный механизм резервирования и отката (аддитивные DDL миграции, атомарные чекпоинты, регламент отката в `AGENTS.md`).
- **5.5** Реальный мониторинг состояния сервисов (`/health`, `worker_watchdog`, живая телеметрия БД и каналов в UI `Інтел`).

### 6. Синхронизация (Synchronization)
- **6.1** GitHub `main`, рабочий код, Render и Vercel production согласованы по одному релизу.
- **6.2** `AGENTS.md` и `PROJECT_STATE.md` полностью соответствуют фактической реализации.
- **6.3** Единый регламент изменений для Codex и Antigravity (`AGENTS.md`).
- **6.4** Автоматические проверки перед публикацией (`npm run acceptance` в `.github/workflows/ci-keepalive.yml`).

### 7. Финальная приёмка (Final Production Sign-Off)

| # | Критерий | Статус | Доказательство (Evidence) |
|---|---|---|---|
| 1 | Достоверность данных | PENDING LIVE VERIFY | Verified after live deploy via `npm run acceptance` + `npm run verify:prod` + browser check |
| 2 | Архитектура | PENDING LIVE VERIFY | Single `adsbClassifier.ts`, dead files removed, single `/api/targets`, `npm run acceptance` |
| 3 | Интерфейс (Desktop + Mobile) | PENDING LIVE VERIFY | Live browser verification at `1280×800` and `375×812` on `https://eye-radar.vercel.app/app` |
| 4 | Производительность | PENDING LIVE VERIFY | `tsc` 0 errors, 100% tests, 0 console errors, Render RAM & payload checks |
| 5 | Автономность | PENDING LIVE VERIFY | Neon Postgres hydration + retention + empty/404 failure resilience checks |
| 6 | Синхронизация | PENDING LIVE VERIFY | Git clean, `AGENTS.md` + `ACCEPTANCE.md` + `PROJECT_STATE.md` synced, Render + Vercel live |
| 7 | Финальная приёмка | PENDING LIVE VERIFY | End-to-end production sign-off |
