from __future__ import annotations

from typing import Awaitable, Callable

from fastapi import Depends, FastAPI, Header, HTTPException

from app.analyze import analyze_bars
from app.config import Settings
from app.db import fetch_bars, make_pool
from app.schemas import AnalyzeBatchRequest, AnalyzeBatchResponse, TickerResult

settings = Settings()
app = FastAPI(title="UltimateMultifactor TA Worker")

BarsProvider = Callable[[str, int], Awaitable[dict]]
_pool = None


@app.on_event("startup")
async def _startup() -> None:
    global _pool
    if not settings.otm_database_url:
        raise RuntimeError("OTM_DATABASE_URL must be set")
    if not settings.ta_worker_secret:
        raise RuntimeError("TA_WORKER_SECRET must be set")
    _pool = await make_pool(settings.otm_database_url)


def get_bars_provider() -> BarsProvider:
    async def provider(ticker: str, lookback_days: int) -> dict:
        if _pool is None:
            raise RuntimeError("db pool not initialized")
        return await fetch_bars(_pool, ticker, lookback_days)
    return provider


def require_auth(authorization: str = Header(default="")) -> None:
    expected = f"Bearer {settings.ta_worker_secret}"
    if not settings.ta_worker_secret or authorization != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/analyze-batch", response_model=AnalyzeBatchResponse)
async def analyze_batch(
    req: AnalyzeBatchRequest,
    _: None = Depends(require_auth),
    provider: BarsProvider = Depends(get_bars_provider),
) -> AnalyzeBatchResponse:
    results = []
    for ticker in req.tickers:
        try:
            bars = await provider(ticker, req.lookback_days)
        except Exception:
            results.append(TickerResult(ticker=ticker, error="fetch_error"))
            continue
        results.append(analyze_bars(ticker, **bars))
    return AnalyzeBatchResponse(results=results)
