# UltimateMultifactor

A standalone stock-discovery pipeline that scores the OTM universe (~5,530 tickers)
on a **technical-first, 7-factor model**, each factor z-scored against its GICS
sector. It reuses OTM's maintained price history and proven scoring components but
produces its own independent ranked discovery list.

## One deployable

### `app/` — Next.js / Prisma on Vercel
The **scoring core**, now fully self-contained on Vercel/Inngest: computes the
three technical vars (**X / Y / Z**) in-process from 2 years of OHLCV per ticker
(`app/lib/ta/`, reading OTM `price_history` directly), fetches P/B, P/S,
EQ-Stability, and EQ-Growth from FMP, z-scores every factor against GICS sector
peers, composites and ranks, and persists results to its own Neon DB. Hosts the
Inngest job, `/api/discovery`, and the UI. See `app/CLAUDE.md`.

### `ta-worker/` — Python / FastAPI (reference only, not deployed)
The original technical engine that computed X / Y / Z over an authenticated
`/analyze-batch` HTTP endpoint on Railway. **Superseded** by the in-process
`app/lib/ta/` port; retained only as the reference implementation. The pipeline
no longer calls it and no Railway service is required. See `ta-worker/CLAUDE.md`.

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
- **Plan 4 (UI) — done.** Discovery screener page at `/` (App Router): a
  coder-minimalist dark/monospace table with sortable columns, a sector filter,
  z-score heat coloring, and CSV download. Client-fetches `/api/discovery`.
  See `app/CLAUDE.md` (UI section).

The app is now **full-stack**: `ta-worker/` (Python / FastAPI on Railway) +
`app/` (Next.js on Vercel — scoring core + Inngest pipeline + `/api/discovery` +
discovery UI).

> Deploy registers the app's `/api/inngest` serve URL in the shared Inngest
> dashboard as a new app **`ultimatemultifactor`**.
