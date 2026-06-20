# UltimateMultifactor — app (scoring core)

## Purpose

This is the **scoring core** of UltimateMultifactor. It ranks the OTM universe
(~5,530 tickers) on **7 factors**, each z-scored against its GICS-sector peers
(per-sector mean/σ, with a market-wide fallback when a sector has < 5 members),
then emits a composite-ranked discovery list.

It is a *secondary* process to OTM: it reuses OTM's maintained price history and
produces its own independent ranked output (future Inngest job, `/api/discovery`,
and UI — Plans 3 and 4, pending).

## The 7 factors

Two buckets:

**Technical (from the TA worker — 2 years of OHLCV):**
- **X Var** — volatility / dispersion proxy
- **Y Var** — trend / centerline factor
- **Z Var** — discrete regime/state var

**Fundamental (from FMP):**
- **P/B** (inverted — cheaper is better)
- **P/S** (inverted — cheaper is better)
- **EQ-Stability** — earnings-quality stability (trend R² of EPS/NetIncome, penalized by YoY volatility)
- **EQ-Growth** — earnings-quality growth (blended CAGR of revenue/EPS/NetIncome)

Each raw factor → sector z-score (`lib/factors/sectorZScore.ts`) → composite
buckets (`technicalScore`, `valuationScore`, `discoveryScore`) →
rank by `discoveryScore` (`lib/factors/composite.ts`).

## Data flow

1. **Read OTM** (`OTM_DATABASE_URL`, read-only): `tickers` (active universe +
   sector) and `price_history` (freshness check) via `lib/db/otmClient.ts` (pg Pool).
2. **Fetch fundamentals** from **FMP** (`FMP_API_KEY`): valuation ratios + income
   statements via `lib/fmp/*`.
3. **Fetch technicals** from the **TA worker** (`TA_WORKER_URL` + `TA_WORKER_SECRET`):
   X/Y/Z vars via `lib/taWorker/client.ts` (`analyzeBatch`, batched 50 at a time).
4. **Z-score + composite + rank** in-process.
5. **Write results** to the app's own Neon DB (`OWN_DATABASE_URL`) via Prisma into
   `advanced_screen_results` (`AdvancedScreenResult` model), replacing any prior
   rows for the same `runDate`.

## Key files

- `lib/factors/sectorZScore.ts` — per-sector z-scoring with market fallback
- `lib/factors/composite.ts` — bucket scores + ranking
- `lib/factors/eqDecomposition.ts` — EQ-Stability / EQ-Growth math
- `lib/fmp/*` — ported FMP client (`client.ts`, `fundamentals-lite.ts`)
- `lib/taWorker/client.ts` — TA worker HTTP client
- `lib/pipeline/loadUniverse.ts` — OTM universe loader + freshness helper
- `lib/pipeline/scoreUniverse.ts` — the orchestration (fetch → score → rank → persist)
- `scripts/run-screen.ts` — CLI entry point
- `prisma/schema.prisma` — `AdvancedScreenResult`

## How to run

```bash
npm test                      # vitest unit tests
npm run run-screen 2026-06-19 # score the universe for a given date (defaults to today)
```

## Environment variables

| Var | Purpose |
|-----|---------|
| `OWN_DATABASE_URL` | App's own Neon DB (Prisma) — results are written here |
| `OTM_DATABASE_URL` | OTM Postgres (read-only) — `tickers` + `price_history` |
| `FMP_API_KEY` | Financial Modeling Prep API key (ratios + income statements) |
| `FMP_BASE_URL` | Optional FMP base URL override (defaults to FMP stable) |
| `TA_WORKER_URL` | Base URL of the TA worker service |
| `TA_WORKER_SECRET` | Bearer secret for the TA worker |

## Gotcha

`scoreUniverse(targetDate)` **aborts** (throws) if OTM `price_history`'s max date
is not equal to `targetDate` — i.e. it refuses to score against stale price data.
Make sure OTM's daily price ingest has run for `targetDate` before invoking the
screen.
