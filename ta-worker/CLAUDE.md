# TA Worker — CLAUDE.md

Python/FastAPI service computing the three UltimateMultifactor technical vars
from 2yr OHLCV. Deployed on Railway; called by the TS pipeline's technical pass.

## What it does
- Reads OTM Neon `price_history` (read-only) for a ticker's bars.
- Computes X Var (centerline dispersion), Y Var (risk/reward), Z Var
  (resistance->support flips). See `app/factors.py` for the math.
- Serves `POST /analyze-batch` (bearer auth) and `GET /health`.

## Key files
- `app/factors.py` — pure X/Y/Z math (start here; fully unit-tested)
- `app/engine.py`  — ATR, S/R clustering, stop/target (adapted from Portfolio rr-service)
- `app/analyze.py` — per-ticker orchestration + failure isolation (+ non-finite guard)
- `app/db.py`      — OTM price_history reader (asyncpg)
- `app/main.py`    — HTTP surface + bearer auth + startup config validation

## Run / test
    python3.11 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
    pytest -v                       # full suite
    uvicorn app.main:app --reload   # local server (needs OTM_DATABASE_URL + TA_WORKER_SECRET)

## Env
OTM_DATABASE_URL (read-only), TA_WORKER_SECRET, TA_LOOKBACK_DAYS. See .env.example.
The app fails fast at startup if OTM_DATABASE_URL or TA_WORKER_SECRET is unset.

## Contract
POST /analyze-batch  body {"tickers": [...], "lookback_days": 504}  ->
  {"results": [{"ticker","x_var","y_var","z_var","diagnostics","error"}, ...]}
Per-ticker failures return null factors + an `error` string; one bad ticker
never fails the batch.

## Gotchas
- Factor math never raises into the response; errors land in `TickerResult.error`.
- Z Var is single-pass over the series — do NOT change it to re-run historical
  analysis per date (would blow up nightly compute over 5,530 tickers).
- Z Var dedups flips per resistance level (clustered to the breakout band) so a
  double-top counts once.
