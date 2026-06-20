import os
os.environ["TA_WORKER_SECRET"] = "testsecret"  # set before app import (used by later API tests)

import pytest
from app.schemas import AnalyzeBatchRequest, TickerResult


def test_request_defaults_lookback():
    req = AnalyzeBatchRequest(tickers=["AAPL", "MSFT"])
    assert req.lookback_days == 504
    assert req.tickers == ["AAPL", "MSFT"]


def test_request_rejects_empty_tickers():
    with pytest.raises(ValueError):
        AnalyzeBatchRequest(tickers=[])


def test_ticker_result_allows_null_factors_with_error():
    r = TickerResult(ticker="XYZ", error="insufficient_bars")
    assert r.x_var is None and r.y_var is None and r.z_var is None


from fastapi.testclient import TestClient
from app.main import app, get_bars_provider


def _fake_provider(trending):
    async def provider(ticker: str, lookback_days: int) -> dict:
        if ticker == "BAD":
            return {"highs": [1, 2], "lows": [0, 1], "closes": [1, 1]}
        return trending
    return provider


def test_health_ok():
    client = TestClient(app)
    assert client.get("/health").json() == {"status": "ok"}


def test_analyze_batch_requires_auth():
    client = TestClient(app)
    r = client.post("/analyze-batch", json={"tickers": ["AAPL"]})
    assert r.status_code == 401


def test_analyze_batch_returns_results():
    trending = {
        "highs": [50 + i * 0.3 + 1 for i in range(120)],
        "lows": [50 + i * 0.3 - 1 for i in range(120)],
        "closes": [50 + i * 0.3 for i in range(120)],
    }
    app.dependency_overrides[get_bars_provider] = lambda: _fake_provider(trending)
    client = TestClient(app)
    r = client.post(
        "/analyze-batch",
        headers={"Authorization": "Bearer testsecret"},
        json={"tickers": ["AAPL", "BAD"]},
    )
    app.dependency_overrides.clear()
    assert r.status_code == 200
    by = {x["ticker"]: x for x in r.json()["results"]}
    assert by["AAPL"]["y_var"] is not None
    assert by["BAD"]["error"] == "insufficient_bars"
