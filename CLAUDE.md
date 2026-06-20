# UltimateMultifactor

A standalone stock-discovery pipeline that scores the OTM universe (~5,530 tickers)
on a **technical-first, 7-factor model**, each factor z-scored against its GICS
sector. It reuses OTM's maintained price history and proven scoring components but
produces its own independent ranked discovery list.

## Two deployables

### `ta-worker/` — Python / FastAPI on Railway
Computes the three technical vars (**X / Y / Z**) from 2 years of OHLCV per ticker
and serves them over an authenticated `/analyze-batch` HTTP endpoint. Heavy numeric
work lives here, isolated from the Next.js app. See `ta-worker/CLAUDE.md`.

### `app/` — Next.js / Prisma on Vercel
The **scoring core**: fetches X/Y/Z from the TA worker, P/B, P/S, EQ-Stability, and
EQ-Growth from FMP, z-scores every factor against GICS sector peers, composites and
ranks, and persists results to its own Neon DB. Also the future home of the Inngest
job, `/api/discovery`, and UI. See `app/CLAUDE.md`.

## Docs

- **Design spec:** `docs/superpowers/specs/2026-06-19-ultimatemultifactor-design.md`
- **Plans:** `docs/superpowers/plans/`
  - `2026-06-19-ta-worker.md` — TA worker (Plan 1)
  - `2026-06-19-scoring-core.md` — scoring core (Plan 2)

## Status

- Plan 1 (TA worker) and Plan 2 (scoring core orchestration) — implemented.
- **Plan 3 (Inngest scheduled job + `/api/discovery`) — done.** `runScreen`
  Inngest function (3 AM ET cron + `screen/run.trigger` event, step-per-batch →
  transactional finalize), `POST /api/admin/trigger-screen` (bearer auth), and
  `GET /api/discovery` (JSON + CSV). See `app/CLAUDE.md`.
- **Plan 4 (UI) — pending.**

> Deploy registers the app's `/api/inngest` serve URL in the shared Inngest
> dashboard as a new app **`ultimatemultifactor`**.
