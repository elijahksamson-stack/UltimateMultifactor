# UltimateMultifactor — Design Spec

**Date:** 2026-06-19
**Status:** Draft for review
**Author:** Eli Samson (w/ Claude)
**Source blueprint:** "Advanced Technical / Valuation Screener Idea (06/19/26)"

---

## 1. Purpose

A standalone stock-discovery / name-selection pipeline that scores the **same ~5,530-ticker universe** as OTM (eli-screener) but on a **forward/technical-first factor model**. It is a *secondary* process to OTM: where OTM ranks on fundamental z-scores with a technical overlay, UltimateMultifactor ranks on three technical "vars" plus four valuation/earnings factors, all z-scored against GICS-sector peers, and emits a ranked discovery list.

It does **not** replace OTM. It reuses OTM's maintained price history and proven components, and produces an independent ranked output surfaced through its own app + UI.

---

## 2. The factor model

Two buckets, seven factors. Every raw factor is **z-scored against its GICS sector** (per-sector mean/σ, with a market-wide fallback when a sector has < 5 members), exactly as OTM does today.

### Technical bucket (X / Y / Z vars) — 2 years of OHLCV only
| Var | Name | Raw formula | Reference |
|-----|------|-------------|-----------|
| **X Var** | Vol factor | Fit a linear regression **centerline** over the window. Partition daily closes into those below vs. above the centerline. `X = (count_below × avg_dist_below) × (count_above × avg_dist_above)`. A symmetric crowding×magnitude dispersion proxy — predicts potential for price volatility. | NEW (worker) |
| **Y Var** | Risk/Reward | `Y = (target − price) / (price − stop)` = distance to price target ÷ distance to stop loss. Predicts upside opportunity relative to downside risk. | REUSE — Portfolio `risk_reward_service.py` `stop_target.rr_ratio` |
| **Z Var** | Momentum | Single pass over the 2yr series: detect resistance clusters (ATR-based clustering), then count clusters that were later **pierced and re-touched from below as support** within the last ~252 bars. Gauges the degree of momentum (how many resistance levels flipped to support). | NEW (worker) |

> Z Var is computed in a **single pass** over the bar series, NOT by re-running full historical analysis at N dates — this keeps nightly compute tractable across 5,530 tickers.

### Valuation bucket — fundamentals
| Factor | Raw source | Direction |
|--------|-----------|-----------|
| **Price-to-Book (P/B)** | FMP `/ratios-ttm` | inverted (lower = better) |
| **Price-to-Sales (P/S)** | FMP `/ratios-ttm` | inverted (lower = better) |
| **Earnings Quality — Stability** | EPS/Net-Income R² + inverse YoY volatility, from FMP `/income-statement` | higher = better |
| **Earnings Quality — Growth** | Revenue/EPS CAGR, from FMP `/income-statement` | higher = better |

The two EQ sub-factors are the explicit split the blueprint calls out ("Stability of Earnings" vs "Growth of Earnings"), computed independently from FMP income statements (not read from OTM's bundled EQ score).

### Composite scoring
```
Technical = mean(zX, zY, zZ)
Valuation = mean(zPB_inv, zPS_inv, zEQstability, zEQgrowth)
DiscoveryScore = mean(Technical, Valuation)     # equal-weight to start
```
All weights live in a single `config/weights.ts` constants file so buckets and individual factors can be re-weighted without touching pipeline logic. Tickers ranked by `DiscoveryScore` descending → the discovery list.

---

## 3. Architecture

Hybrid: TypeScript/Inngest orchestration (mirrors OTM) + a Python TA worker (reuses Portfolio's trendline engine).

```
┌─ UltimateMultifactor (Next.js + Prisma + Inngest · Vercel) ───────────┐
│  Nightly Inngest pipeline (fires ~2h AFTER OTM's 7PM run)             │
│   1. Freshness gate  — abort unless OTM price_history has today       │
│   2. Fundamentals pass — own FMP client → P/B, P/S, EQ-stab, EQ-grow  │
│   3. Technical pass    — batched calls to Python TA worker → X,Y,Z    │
│   4. Sector z-score    — lifted OTM engine over all 7 raw factors     │
│   5. Composite + rank  — write AdvancedScreenResult (own Neon DB)     │
│   6. Surface           — /api/discovery (JSON + CSV) + UI screener    │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTPS, bearer auth, batched, concurrency-capped
              ┌─────────────────▼──────────────────┐
              │  TA Worker (FastAPI · Railway)       │
              │  reuses risk_reward_service.py       │
              │  reads OTM price_history (read-only) │
              │  POST /analyze-batch → {xVar,yVar,zVar} per ticker │
              └──────────────────────────────────────┘
```

### Components: reuse vs. build
| Component | Origin | Action |
|-----------|--------|--------|
| FMP client + rate limiter | OTM `lib/fmp/` | **Lift verbatim** (750/min throttle) |
| Sector z-score + grouping | OTM `scripts/calculate-all-rankings.ts` | **Lift + generalize** to 7 factors |
| Inngest pipeline pattern | OTM `inngest/functions.ts` | **Lift pattern** (event-driven, sub-5-min steps) |
| Trendline / channel / S/R engine | Portfolio `risk_reward_service.py` | **Reuse** in worker |
| Y Var (R/R ratio) | Portfolio `stop_target.rr_ratio` | **Reuse directly** |
| X Var (centerline dispersion) | — | **New** (~40 lines, worker) |
| Z Var (resistance→support flips) | — | **New** (~120 lines, worker) |
| Discovery UI screener tab | OTM UI patterns | **Adapt** |

---

## 4. TA Worker contract

FastAPI service, deployed on Railway (Vercel can't host long-running numpy/pandas TA — same reason OTM's `rr-service` runs on Railway).

**`POST /analyze-batch`**
```jsonc
// request
{ "tickers": ["AAPL", "MSFT", ...], "lookback_days": 504 }
// response
{ "results": [
    { "ticker": "AAPL", "xVar": 12.4, "yVar": 2.15, "zVar": 3,
      "diagnostics": { "centerline_slope": 0.08, "r2": 0.62, "bars": 504 } },
    { "ticker": "MSFT", "xVar": null, "error": "insufficient_bars" }
] }
```
- Reads OTM `price_history` (read-only) for OHLCV; no re-scraping.
- Auth: `Authorization: Bearer ${TA_WORKER_SECRET}`.
- Per-ticker failures return `null` factor + `error` string; never fail the whole batch.
- Batched + concurrency-capped on the TS side to respect worker throughput.

---

## 5. Data model

**Own Neon database** (new database in the same Neon account as OTM) for results:
- `ScreenerRun` — run tracking: id, runDate, status, tickersProcessed, startedAt, completedAt, errorLog.
- `AdvancedScreenResult` — per ticker per run:
  `runDate, ticker, sector,`
  raw: `xVar, yVar, zVar, pb, ps, eqStability, eqGrowth,`
  sector-z: `zX, zY, zZ, zPB, zPS, zEQStability, zEQGrowth,`
  composites: `technicalScore, valuationScore, discoveryScore, rank`.
  Unique on `(runDate, ticker)`, indexed on `(runDate, rank)`.

**Reads** OTM's Neon `price_history` via a read-only connection string (`OTM_DATABASE_URL`). No price duplication anywhere.

---

## 6. Scheduling & error handling

- **Schedule:** Inngest cron ~2h after OTM's 7PM ET run.
- **Freshness gate:** step 1 queries OTM `price_history` max date; aborts the run (logged, no partial write) if it isn't today — prevents scoring on stale prices.
- **Isolation:** a per-ticker failure (FMP miss, worker error, insufficient bars) yields a null factor → that ticker is dropped from *that factor's* sector pool and logged; the run continues.
- **Rate limits:** FMP reuses OTM's 750/min limiter (~420/min effective). Worker calls retried with exponential backoff.
- **Idempotency:** re-running a date upserts `AdvancedScreenResult` on `(runDate, ticker)`.

---

## 7. Integration / secrets

All reused from existing OTM/Portfolio infrastructure; nothing hardcoded, validated at startup. `.env*` gitignored.

| Var | Source | Notes |
|-----|--------|-------|
| `FMP_API_KEY` | reuse OTM | fundamentals pass |
| `OTM_DATABASE_URL` | reuse OTM Neon | **read-only** — for `price_history` |
| `OWN_DATABASE_URL` | new Neon database (same account) | results |
| `INNGEST_EVENT_KEY` | reuse OTM | same Inngest account, new app id |
| `INNGEST_SIGNING_KEY` | reuse OTM | " |
| `TA_WORKER_URL` | Railway (provision on deploy) | worker base URL |
| `TA_WORKER_SECRET` | newly generated | bearer token, shared with worker |

**Deploy targets:** Next.js app → **new Vercel project** under the existing team (`team_yDv40oTCHCoSfAwd9MpcSY6U`). Python worker → **Railway** (like `rr-service`).

---

## 8. Testing (TDD, 80%+ coverage)

- **Worker unit tests (pytest):** X/Y/Z math against hand-verified synthetic OHLCV fixtures (e.g. a known up-channel where centerline dispersion and flip counts are computable by hand); Y Var equals `(target−price)/(price−stop)` on a fixed level set.
- **TS unit tests:** z-score + sector-grouping (incl. <5-member fallback); EQ stability/growth decomposition from a fixed income-statement fixture; composite/weighting from `config/weights.ts`.
- **Integration test:** one ticker end-to-end (mock OTM price_history + mock FMP + mock worker) → asserts a populated `AdvancedScreenResult` row.
- **Freshness-gate test:** stale OTM date → run aborts with no writes.

---

## 9. Out of scope (v1)

- No re-scraping of price history (always read OTM's).
- No portfolio construction / trade tracking (OTM's concern).
- No ML factor weighting (equal-weight, tunable constants only).
- No backtest harness for the factors (methodology validation can come after scores are trusted).

---

## 10. Open questions resolved

| Decision | Resolution |
|----------|-----------|
| Stack | Hybrid: TS/Inngest orchestration + Python TA worker |
| Data source | Read OTM Neon for prices; own FMP for fundamentals/EQ |
| X Var reference line | Fitted regression **centerline** |
| v1 surface | Full app like OTM, incl. UI screener tab |
| Name / folder | **UltimateMultifactor** @ `ClaudeApps/UltimateMultifactor/` |
| Bucket weighting | Equal-weight, tunable in `config/weights.ts` |
| Results DB | New Neon database in the **same account** |
