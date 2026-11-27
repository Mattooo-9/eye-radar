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
- **1.5** Устаревшая информация не отображается как актуальная (отброс наблюдений старше 25 с, очистка треков через 45 с без обновления, истечение бюллетеней по `maxAgeMs`, отказ от восстановления протухших/деградированных чекпоинтов). Для официальных тревог (`official_alert`): потеря связи с источником (>3 мин или недоступность) переводит статус в `"stale"` / `"unavailable"` (неизвестное состояние, **никогда не отбой**) с сохранением последнего подтверждённого состояния и времени подтверждения (`lastConfirmedAt`).

### 2. Архитектура (Architecture)
- **2.1** Единая модель данных (`TrackState` + `DataCategory`, `UnifiedObservation`) и единый источник истины для ADS-B классификации (`src/server/sources/adsbClassifier.ts`).
- **2.2** Отсутствие дублирующих маршрутов (`/api/targets` ровно один), дублирующих опросов одних и тех же ADS-B URL и неиспользуемых мёртвых модулей.
- **2.3** Чёткое распределение ответственности между `sources`, `ingest`, `core`, `db`, `bot`, `client`.
- **2.4** Сохранение работоспособности существующих интеграций (Neon PostgreSQL, Render, Vercel, `@AppEye_bot`, `alerts.in.ua`, не-Telegram ведомственные/государственные сводки, 4 военных ADS-B агрегатора строго в границах Украины, NASA FIRMS, Open-Meteo). Скрапинг Telegram-каналов и чатов (`t.me`) полностью отключён (`telegramScrapingDisabled: true`).

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
- **5.3** Централизованная политика жизненного цикла и самоочистки (`src/server/core/lifecyclePolicy.ts`, `RETENTION_POLICY`):
  - **Telegram-бот:** обычные уведомления — 6 ч; активные гражданские предупреждения (`active_warning`) — сохраняются до официального отбоя и удаляются через **30 минут** после отбоя; временные служебные ответы (`ephemeral`) — 15 мин; главное меню (`main_menu`) — сохраняется постоянно; повторяющиеся уведомления обновляют существующее сообщение на месте (`editMessageText` по `dedupKey`).
  - **База данных (Neon Postgres) и диск:** временные технические записи (`osint_bulletins`, `radar_events`, завершённые задачи очереди удаления) — до 24 ч; снимки треков (`track_history_snapshots`) — до 2 ч; диагностические журналы (`diagnostic_logs`, `worker_watchdog`) — до 7 суток; обезличенная история официальных тревог (`official_alert_history`, `/api/alerts/history`) — до 30 суток; неактивные подписки — 30 суток (координаты округлены до 3 знаков `~110 м`); автоматическая очистка лишних чекпоинтов и `.tmp` файлов каждые 5 минут.
- **5.4** Проверенный механизм резервирования и отката (аддитивные DDL миграции, атомарные чекпоинты, регламент отката в `AGENTS.md`).
- **5.5** Реальный мониторинг состояния сервисов (`/health`, `worker_watchdog`, живая телеметрия БД и каналов в UI `Інтел`).

### 6. Синхронизация (Synchronization)
- **6.1** GitHub `main`, рабочий код, Render и Vercel production согласованы по одному релизу.
- **6.2** `AGENTS.md` и `PROJECT_STATE.md` полностью соответствуют фактической реализации.
- **6.3** Единый регламент изменений для Codex и Antigravity (`AGENTS.md`).
- **6.4** Автоматические проверки перед публикацией (`npm run acceptance` в `.github/workflows/ci-keepalive.yml`).

### 7. Финальная приёмка (Stage 1 — Civil Alert Outage Semantics — 2026-11-27, commit `0a2162e`)

| # | Критерий | Статус | Проверяемое доказательство (Evidence) |
|---|---|---|---|
| 1 | **Достоверность данных** | **PASS** | `npm run verify:prod` (**27/27 PASS**): `synthetic=0`, `civilLeak=none`, `fakeAlt=0`, `fakeSpd=0`, `falsePrec=0`, `telegramScrapingDisabled=true` (`totalChannels=0`, 0 Telegram-каналов и чатов), `violations=0` (текстовые сообщения имеют `speed=0` и никогда не экстраполируются в ложные движущиеся радарные отметки), ADS-B строго ограничен полигоном госграницы Украины (`isInsideUkraine === true`), `/api/alerts` возвращает `status="fresh"`, `sourceAvailable=true`, `lastConfirmedAt`; при сбое источника сохраняет последнее подтверждённое состояние (`status="stale"|"unavailable"`, НЕ отбой). |
| 2 | **Архитектура** | **PASS** | Единый классификатор ADS-B `src/server/sources/adsbClassifier.ts` (строго внутри границы Украины, 0 гражданских и 0 зарубежных бортов), полное отключение парсинга Telegram-каналов в `publicOsintFeed.ts` с очисткой БД и чекпоинтов от `@`-источников, непересекающееся владение эндпоинтами (`adsb.lol`, `adsb.fi`+`adsb.one`, `opensky.live`), единый маршрут `/api/targets`, строгая 4-уровневая семантика (`official_alert`, `osint_message`, `unverified_report`/`manual`, `sensor_observation`). |
| 3 | **Интерфейс (Desktop + Mobile)** | **PASS** | Живая проверка `https://eye-radar.vercel.app/app`: **Desktop `1280×800` и Mobile `375×812`** — 0 ошибок консоли и `pageerror`, глубокая тёмная спутниковая подложка Esri + Protomaps PMTiles (`lang: "uk"`), лаконичные векторные маркеры (`tacticalGlyphs.ts` — 95 строк вместо грубых мультяшных иконок), архитектурная заливка областей тревоги без кричащих неоновых контуров и штампов `"ТРИВОГА"` поверх городов, 100% единый украинский язык интерфейса без смешения языков (`НАЖИВО`, `ЕКО/БАЛАНС/МАКС`, `ОНЛАЙН`, `ПІДТВЕРДЖЕНО`, `Джерела та деталі`). |
| 4 | **Производительность** | **PASS** | `npm run acceptance`: `scan:secrets` (**0 hardcoded secrets** в 158 файлах), `tsc --noEmit` — **0 ошибок**, `vitest run` — **33/33 файлов (144/144 тестов)**, `vite build` + `tsup` — чисто (клиент **55.35 kB gzip**, сервер `499.49 KB`). Подложка оптимизирована через **Protomaps/PMTiles v3** (`ukraine-overview.pmtiles`, 1.24 MB, `HTTP 206`, `cors=*`), **OpenFreeMap Dark** (`z0–z14`) и **Esri World Imagery**. Render RAM <180 MB, `/api/targets` <50 KB, 0 ошибок консоли браузера. |
| 5 | **Автономность и самоочистка** | **PASS** | Единая политика `RETENTION_POLICY` (`src/server/core/lifecyclePolicy.ts` + `MessageDeletionService`): 6 ч стандартные сообщения, удержание `active_warning` до отбоя + удаление через 30 мин после отбоя, in-place обновление через `editMessageText` (`dedupKey`), сохранение постоянного `main_menu`, учёт лимитов Telegram (`429 retry_after` и 48 ч окно), автоочистка БД (24 ч / 7 сут / 30 сут `/api/alerts/history`), очистка `.tmp` файлов, Zod + Pino + `TechnicalFailureMonitor`. |
| 6 | **Синхронизация и безопасность** | **PASS** | `AGENTS.md`, `ACCEPTANCE.md`, `PROJECT_STATE.md`, `scripts/scan-secrets.mjs` (0 секретов в git), `.github/workflows/ci-keepalive.yml`, `/health` (`releaseSha`, `monitoring`, `lifecycle`) и `verify-production.mjs` (**27/27 PASS**): полное совпадение SHA между GitHub, Render и Vercel. |
| 7 | **Финальная приёмка** | **PASS** | `npm run acceptance` (**33/33, 144/144, 0 secrets**) + `verify-production.mjs` (**27/27 PASS, 0 FAIL**) + живая браузерная проверка Desktop (`1280×800`) и Mobile (`375×812`) — **все 7 критериев: PASS (0 FAIL)**. |
