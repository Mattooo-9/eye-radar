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

### 7. Финальная приёмка (Final Production Sign-Off — 2026-11-27)

| # | Критерий | Статус | Проверяемое доказательство (Evidence) |
|---|---|---|---|
| 1 | **Достоверность данных** | **PASS** | `npm run verify:prod`: `synthetic=0`, `civilLeak=none`, `fakeAlt=0` (0 выдуманных высот на OSINT), `missingProvenance=0/17`, `missingCategory=0/17`, `categories={sensorObservations:2, osintMessages:15, officialAlertsActive:14}`, `/api/eo/change-detection` возвращает `{available:false}`. `src/test/acceptance.test.ts`: 9/9 PASS. В живом браузере `TargetCard` показывает `ТЕКСТОВЕ ПОВІДОМЛЕННЯ (OSINT)`, `Швидкість: Невідомо`, `Висота польоту: Невідомо`, оригинальную цитату `@raketa_trevoga` и 0 выдуманных баз/ТТХ. |
| 2 | **Архитектура** | **PASS** | Единый классификатор ADS-B `src/server/sources/adsbClassifier.ts`, непересекающееся владение эндпоинтами (`adsb.lol`, `adsb.fi`+`adsb.one`, `opensky.live`), единый маршрут `/api/targets`, удалено 10 неиспользуемых файлов и 2 521+ строк дублей/шаблонов (`0440b9d`), `DataCategory` закреплён в `types.ts` и `TrackManager`. Все существующие интеграции сохранены (`HEALTHY`). |
| 3 | **Интерфейс (Desktop + Mobile)** | **PASS** | Живая проверка `https://eye-radar.vercel.app/app` (`dpl_FhT1ZLV1LGAcNtWu3pRux2ZSaLiL`): **Desktop `1280×800`** — 0 ошибок консоли, `LIVE WS`, разделённый `LiveThreatDrawer` (`Повідомлення ППО / OSINT` и `Спостереження ADS-B`), минималистичный `TargetCard`, `TrackInspectorModal` по запросу (`Деталі (Provenance)`). **Mobile `375×812`** — 0 ошибок консоли, `overflowEls: []`, видимая кнопка `РАПОРТ`, **0 наложений** (`ЦІЛІ` и `◎ МОЯ ЛОКАЦІЯ` на 17.4 px выше таймлайна, шкала `100 km` на 26.2 px ниже). |
| 4 | **Производительность** | **PASS** | `npm run acceptance`: `tsc --noEmit` — **0 ошибок**, `vitest run` — **30/30 файлов (127/127 тестов)**, `vite build` + `tsup` — чисто (клиент `index.js` сокращён до **53.27 kB gzip**). В production: Render RAM **83 MB** (<180 MB), `/api/targets` **78.6 KB** (<100 KB), `bloatedEvidence=0`, 0 ошибок консоли браузера, 0 зависших фоновых задач. |
| 5 | **Автономность** | **PASS** | Neon PostgreSQL `connected=true (92 ms)`, 54 сохранённых бюллетеня и 110 снимков истории, автогидратация при старте (`hydrateFromDb`), санитизация чекпоинтов (`57261ec`), 14/14 каналов ППО онлайн, чистая обработка отсутствующего трека (`HTTP 404`) и пустых потоков (`acceptance.test.ts`), автоочистка БД (24 ч / 2 ч) и бота (6 ч), CI keepalive каждые 10 мин (`.github/workflows/ci-keepalive.yml`), регламент отката в `AGENTS.md`. |
| 6 | **Синхронизация** | **PASS** | `AGENTS.md`, `ACCEPTANCE.md`, `PROJECT_STATE.md`, `package.json` (`acceptance` + `verify:prod`), GitHub `origin/main`, Render (`57261ec`/`04267fe`) и Vercel Production (`dpl_FhT1ZLV1LGAcNtWu3pRux2ZSaLiL`, `/assets/index-DA0Gu-xj.js`) полностью синхронизированы. Единый протокол для Codex и Antigravity закреплён в `AGENTS.md`. |
| 7 | **Финальная приёмка** | **PASS** | `npm run acceptance` (30/30, 127/127) + `npm run verify:prod` (**15/15 PASS, 0 FAIL**) + живая браузерная проверка Desktop (`1280×800`) и Mobile (`375×812`) — **все 7 критериев: PASS (0 FAIL)**. |
