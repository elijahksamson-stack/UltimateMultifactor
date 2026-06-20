# UltimateMultifactor — app (scoring core)

## Purpose

This is the **scoring core** of UltimateMultifactor. It ranks the OTM universe
(~5,530 tickers) on **7 factors**, each z-scored against its GICS-sector peers
(per-sector mean/σ, with a market-wide fallback when a sector has < 5 members),
then emits a composite-ranked discovery list.

It is a *secondary* process to OTM: it reuses OTM's maintained price history but
produces its own independent ranked output (Inngest job, `/api/discovery`, UI).
It is now **fully self-contained on Vercel/Inngest** — the technical factors are
computed in-process (no external service).

## The 7 factors

Two buckets:

**Technical (computed in-process from 2 years of OHLCV — `lib/ta/`):**
- **X Var** — volatility / dispersion proxy (regression-residual dispersion)
- **Y Var** — trend / risk-reward factor (distance-to-target / distance-to-stop)
- **Z Var** — discrete regime/state var (resistance→support flip count)

**Fundamental (from FMP):**
- **P/B** (inverted — cheaper is better)
- **P/S** (inverted — cheaper is better)
- **EQ-Stability** — earnings-quality stability (trend R² of EPS/NetIncome, penalized by YoY volatility)
- **EQ-Growth** — earnings-quality growth (blended CAGR of revenue/EPS/NetIncome)

Each raw factor → sector z-score (`lib/factors/sectorZScore.ts`) → composite
buckets (`technicalScore`, `valuationScore`, `discoveryScore`) →
rank by `discoveryScore` (`lib/factors/composite.ts`).

**Filter:** the published list keeps only names with **no negative z on any
factor** (`scoreRawRows` in `lib/pipeline/batch.ts`) — i.e. at or above sector
peers on all 7 metrics. A null z (missing data) is not negative and doesn't drop
a row. This typically reduces ~5,500 names to ~100-200 "strong across the board".

## Data storage

The app touches **two separate Neon Postgres databases**, with different access
patterns and clients:

### 1. OTM database — READ-ONLY source (`OTM_DATABASE_URL`)

This is **OTM's own Neon DB** (the same database the Website/onthemoney.ai app
owns). UMF reads it through a dedicated least-privilege role **`umf_readonly`**
(SELECT on `tickers` + `price_history` only), via a raw `pg` Pool
(`lib/db/otmClient.ts`) — *not* Prisma.

- `tickers` — active universe + GICS `sector` (`WHERE is_active = true`).
- `price_history` — daily OHLCV bars; columns used: `ticker`, `date`, `high`,
  `low`, `close`. The technical pass pulls the newest `lookbackDays` (default
  504 ≈ 2y) bars per ticker via a single windowed query (`lib/ta/bars.ts`).

> **Credential gotcha:** the `umf_readonly` role lives on OTM's Neon DB and its
> password must match what's in Vercel's `OTM_DATABASE_URL`. If they drift, the
> pipeline fails on the very first gate step (`otmPriceMaxDate`) with
> `password authentication failed for user 'umf_readonly'`, and — because the
> `ScreenerRun` row isn't created until step 2 — leaves **no trace** in our DB.
> To (re)provision: as OTM's `neondb_owner`, `CREATE/ALTER ROLE umf_readonly
> LOGIN PASSWORD …; GRANT SELECT ON public.tickers, public.price_history`.

### 2. UMF's own database — READ/WRITE results (`OWN_DATABASE_URL`)

The app's **own** Neon DB, accessed via **Prisma** (`lib/db/ownClient.ts`).
Defined in `prisma/schema.prisma` — three tables:

- **`screener_runs`** (`ScreenerRun`) — one row per `runDate` (unique). Tracks
  `status` (`running` | `complete` | `failed`), `totalBatches`,
  `completedBatches`, `tickersProcessed`, timestamps, `errorLog`.
- **`raw_factor_staging`** (`RawFactorStaging`) — **transient** per-ticker raw
  factor values written batch-by-batch, then consumed and cleared by finalize.
  Unique on `(runDate, ticker)`.
- **`advanced_screen_results`** (`AdvancedScreenResult`) — the **published**
  ranked output the UI/API read. Unique on `(runDate, ticker)`, indexed on
  `(runDate, rank)`.

**Column types matter (and bit us once):**
- Raw factor magnitudes — `xVar`, `yVar`, `pb`, `ps`, `eqStability`, `eqGrowth`
  — are **`Float` (double precision)**, NOT fixed-scale `Decimal`. X Var is an
  unbounded product-of-sums (observed up to ~6.9e15 for thin penny stocks); it
  overflowed the original `Decimal(18,6)` (~1e12 cap) and aborted the run on
  insert. These columns only feed *relative* z-scores, so precision is moot and
  double precision is the right type.
- `zVar` is `Int`. The z-score columns (`zX`…`zEQGrowth`) and the composite
  scores (`technicalScore`, `valuationScore`, `discoveryScore`) are
  `Decimal(10,4)` — standardized/bounded values that never approach the limit.
  `rank` is `Int`.

**Data lifecycle per run (all keyed by `runDate`, pinned to UTC-midnight):**
1. `load-universe` upserts the `ScreenerRun` row to `running` and deletes any
   prior `raw_factor_staging` rows for the date.
2. Each batch appends 50 tickers' raw factors to `raw_factor_staging`.
3. `finalize` runs a **single transaction**: delete existing
   `advanced_screen_results` for the date → insert the freshly ranked rows (in
   chunks of 1000) → delete the staging rows → mark the run `complete`. The swap
   is atomic, so the published list is always internally consistent.

## Data flow (one run)

1. **Gate on freshness** — read OTM `price_history` max `date`; abort unless it
   equals the target date (`lib/pipeline/loadUniverse.ts`).
2. **Load universe** — active `tickers` + sector from OTM.
3. **Compute technicals in-process** (`lib/ta/`): windowed read of OHLCV from
   OTM `price_history`, compute X/Y/Z locally via `analyzeBatch`, batched 50 at
   a time. (Formerly a separate Railway TA worker; now fully in-process — no
   external service, no `TA_WORKER_*` env vars. The `ta-worker/` Python service
   is retained only as the reference implementation and is no longer deployed.)
4. **Fetch fundamentals** from **FMP** (`FMP_API_KEY`): per-ticker valuation
   ratios + income statements via `lib/fmp/*`. **FMP failures are caught
   per-ticker** → that ticker's fundamental factors become null; they never fail
   the batch. (So if `FMP_API_KEY` is missing/invalid the screen still completes
   with X/Y/Z populated and P/B, P/S, EQ-* null.)
5. **Z-score + composite + rank** in-process (`lib/factors/*`).
6. **Persist** to `advanced_screen_results` (see lifecycle above).

## Key files

- `lib/db/otmClient.ts` — read-only `pg` Pool to OTM (`umf_readonly`)
- `lib/db/ownClient.ts` — Prisma client to UMF's own DB
- `lib/ta/` — in-process technical pass: `factors.ts` (X/Y/Z math), `engine.ts`
  (ATR + S/R + stop/target), `analyze.ts` (per-ticker orchestration), `bars.ts`
  (OTM `price_history` windowed reader), `index.ts` (`analyzeBatch`). Unit-tested
  in `test/ta-*.test.ts` for parity with the Python reference.
- `lib/factors/sectorZScore.ts` — per-sector z-scoring with market fallback
- `lib/factors/composite.ts` — bucket scores + ranking
- `lib/factors/eqDecomposition.ts` — EQ-Stability / EQ-Growth math
- `lib/fmp/*` — ported FMP client (`client.ts`, `fundamentals-lite.ts`)
- `lib/pipeline/loadUniverse.ts` — OTM universe loader + freshness helpers
- `lib/pipeline/batch.ts` — `computeBatchRawFactors`, `persistStaging`,
  `scoreRawRows`, `finalizeScreen`
- `lib/pipeline/scoreUniverse.ts` — single-process orchestration (CLI path)
- `inngest/functions.ts` — the `runScreen` Inngest function (production path)
- `scripts/run-screen.ts` — CLI entry; `scripts/verify-ta.ts` /
  `scripts/scan-ta-range.ts` — read-only TA dry-run + magnitude diagnostics
- `prisma/schema.prisma` — `ScreenerRun`, `RawFactorStaging`, `AdvancedScreenResult`

## How to run

```bash
npm test                      # vitest unit tests
npm run run-screen 2026-06-18 # score the universe for a trading day (CLI, single process)
npx tsx scripts/verify-ta.ts 25     # dry-run: compute X/Y/Z for first 25 tickers (no writes)
npx tsx scripts/scan-ta-range.ts    # scan factor magnitudes across the universe (no writes)
```

Both `run-screen` and the scripts need `OWN_DATABASE_URL` + `OTM_DATABASE_URL`
exported in the shell (they do not auto-load `.env`).

## Inngest pipeline + API (production path)

The screen runs as an **Inngest function** (`inngest/functions.ts` → `runScreen`),
served at `/api/inngest` (`app/api/inngest/route.ts`, `maxDuration = 300`).

**Triggers** (either fires the same function):
- **Cron** — `TZ=America/New_York 0 3 * * *` (3:00 AM ET daily). ⚠️ See gotcha.
- **Event** — `screen/run.trigger` with optional `{ data: { targetDate } }`.

**Step shape** (each `step.run` is a retriable, memoized unit; `retries: 2`):
1. `resolve-and-gate` — resolve target date, then **gate on OTM freshness**
   (`otmPriceMaxDate` + `latestDateIsToday`); throws if `price_history` is stale.
   **The `ScreenerRun` row does not exist yet here** — a throw in this step
   (bad OTM creds, stale data) leaves no DB row and `onFailure` has nothing to
   mark, so the only error trace is in the Inngest dashboard.
2. `load-universe` — load the active universe, upsert the `ScreenerRun` row to
   `running`, and clear any prior `raw_factor_staging` rows for the date.
3. `batch-N` — one step **per 50 tickers** (`BATCH` in `inngest/functions.ts`):
   compute raw factors (in-process TA + FMP fetched with bounded concurrency,
   `FMP_CONCURRENCY`), persist to `raw_factor_staging`, increment
   `completedBatches`. A batch throws only on a non-recoverable error; a single
   bad ticker never fails it. **Batch is kept small on purpose** — large batches
   (e.g. 250) issue enough FMP calls in one burst to trip the plan's sustained
   rate limit and serialize via the circuit breaker (~60× slower per ticker).
4. `finalize` — `finalizeScreen(date)` z-scores/composites/ranks the staged rows
   and writes `advanced_screen_results` **transactionally**, then marks the
   `ScreenerRun` `complete`.

`onFailure` marks any still-`running` row `failed` with a generic message — the
detailed step error lives in the Inngest dashboard.

**Endpoints:**

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/admin/trigger-screen?date=YYYY-MM-DD` | Bearer `ADMIN_TRIGGER_SECRET` | Manually fire `screen/run.trigger` (omit `date` → today) |
| `GET /api/discovery?sector=&limit=&format=csv` | — | Latest ranked list — derives the run from the newest `runDate` **in `advanced_screen_results`** (not `screener_runs.status`), so the page stays populated during a re-run. 404 `no completed screen yet` if empty. All numeric Decimal columns are coerced to `number` (else the UI renders them blank). `format=csv` streams a CSV. |
| `GET /api/price-history?ticker=&days=` | — | OTM `price_history` OHLC for one ticker (validated, parameterized; default 504 bars). Powers the price sparkline + buy-point. |
| `/api/inngest` | Inngest signing key | Inngest serve route. `PUT` re-registers the app/functions with Inngest Cloud (sync). |

## UI

The discovery screener UI lives at `/` (App Router). It uses a **coder-minimalist
theme** — dark background, monospace type, hairline borders, a single mint accent —
with design tokens declared as CSS variables in `app/globals.css`.

Two routes: `/` (discovery table) and `/dashboard` (sector breadth + buy-point demos), linked to each other.

- `app/page.tsx` / `app/ui/DiscoveryTable.tsx` — the discovery table. Fetches
  `GET /api/discovery?limit=500`, sortable columns, **sector filter**, **CSV
  download**. Each numeric column gets a **continuous mint-intensity gradient
  background** normalized across visible rows (`lib/ui/gradient.ts`) so standouts
  glow. **Click a row** → `StockDetail`. ⚠️ Renders any non-200 (incl. the honest
  404) as "failed to load discovery results" — usually means *no run completed*.
- `app/ui/StockDetail.tsx` — slide-over with a detailed price SVG sparkline
  (`GET /api/price-history`): close line + regression centerline + **±1σ
  dispersion channel** (which visualizes the X-Var factor). Geometry in `lib/ui/sparkline.ts`.
- `app/dashboard/page.tsx` / `app/ui/Dashboard.tsx` — KPI tiles (names, sectors
  represented, **effective-sector breadth = 1/HHI**, top sector, avg score), a
  **sector donut** (`lib/ui/donut.ts`, mint-intensity ramp) + "opportunities by
  sector" table, and **top-6 buy-point cards** (sparkline + `lib/ui/buyPoint.ts`:
  channel position, trend, entry-strength 0-100 — favors uptrend pullbacks).
- `app/ui/discovery.module.css`, `app/ui/dashboard.module.css` — CSS modules.
- `lib/ui/` — `format.ts` (`formatScore`/`compareBy`/`zHeat`), `gradient.ts`
  (`heatBg`/`rangeOf`), `sparkline.ts` (`buildChart`/`linearFit`), `buyPoint.ts`,
  `donut.ts`. All pure, tested in `test/format.test.ts`, `test/ui-viz.test.ts`,
  `test/dashboard-viz.test.ts`.

## Environment variables

| Var | Purpose |
|-----|---------|
| `OWN_DATABASE_URL` | App's own Neon DB (Prisma) — results are written here |
| `OTM_DATABASE_URL` | OTM Neon DB (read-only as `umf_readonly`) — `tickers` + `price_history` |
| `FMP_API_KEY` | Financial Modeling Prep API key (ratios + income statements) |
| `FMP_BASE_URL` | Optional FMP base URL override (defaults to FMP stable) |
| `INNGEST_EVENT_KEY` | Inngest event key (sending events / `inngest.send`) |
| `INNGEST_SIGNING_KEY` | Inngest signing key (verifies the `/api/inngest` serve route) |
| `ADMIN_TRIGGER_SECRET` | Bearer secret for `POST /api/admin/trigger-screen` |

(There are **no** `TA_WORKER_*` vars — technicals are in-process.)

## Gotchas

- **Freshness gate / target resolution (`resolveScreenTarget`).** A run with an
  **explicit date** (manual trigger) must equal OTM `price_history`'s max `date`
  or it throws (refuses stale data). A run with **no date** (the 3 AM cron / any
  no-date trigger) targets OTM's **latest available trading day**, so the gate
  self-passes — this is why the nightly run completes on its own despite prices
  lagging a day (and market holidays like Juneteenth 6/19). Auto runs also throw
  if OTM's max bar is > `MAX_OTM_STALENESS_DAYS` (7) old — a broken-ingest guard.
- **X Var magnitude / Float columns.** See *Data storage* — raw factor columns
  are `double precision` for a reason (X Var spans ~12 orders of magnitude);
  don't narrow them back to `Decimal`.
- **Robust z-scoring (`lib/factors/sectorZScore.ts`).** Raw factors are
  **winsorized to their [2nd, 98th] peer percentiles** before mean/σ and before
  scoring, and `xVar` is additionally **log1p-transformed** (`FactorSpec.log`),
  so penny-stock data artifacts can't hijack a sector's distribution. Without
  this, a single extreme value produced ~33σ z-scores and dominated the ranking.
  If you add a multiplicative, order-of-magnitude-spread factor, set `log: true`
  for it in the `FACTORS` spec (`lib/pipeline/batch.ts`).
- **No completed run ⇒ 404.** `/api/discovery` returns 404 until a run reaches
  `complete`. The UI surfaces that as "failed to load discovery results".
