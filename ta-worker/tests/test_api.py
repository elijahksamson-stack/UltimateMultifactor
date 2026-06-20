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
