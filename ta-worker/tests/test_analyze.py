from app.analyze import analyze_bars
from decimal import Decimal
from app.db import rows_to_bars


def test_analyze_bars_returns_all_three_vars(trending_bars):
    res = analyze_bars("AAPL", **trending_bars)
    assert res.ticker == "AAPL"
    assert res.x_var is not None and res.x_var >= 0.0
    assert res.y_var is not None
    assert res.z_var is not None and res.z_var >= 0
    assert res.error is None
    assert res.diagnostics["bars"] == 120


def test_analyze_bars_insufficient_returns_error():
    res = analyze_bars("XYZ", highs=[1, 2], lows=[0, 1], closes=[1, 1])
    assert res.error == "insufficient_bars"
    assert res.x_var is None


def test_analyze_bars_non_finite_returns_error():
    highs = [float("nan")] + [50.0] * 40
    lows = [1.0] * 41
    closes = [40.0] * 41
    res = analyze_bars("XYZ", highs=highs, lows=lows, closes=closes)
    assert res.error == "non_finite_bars"
    assert res.x_var is None


def test_analyze_bars_overflow_returns_error():
    closes = [1.0] * 29 + [1e200]
    highs = [c + 0.5 for c in closes]
    lows = [c - 0.5 for c in closes]
    res = analyze_bars("X", highs=highs, lows=lows, closes=closes)
    assert res.error is not None
    assert res.x_var is None


def test_rows_to_bars_orders_ascending_and_floats():
    rows = [
        {"date": "2026-01-03", "high": Decimal("12.0"), "low": Decimal("10.0"), "close": Decimal("11.0")},
        {"date": "2026-01-02", "high": Decimal("11.0"), "low": Decimal("9.0"), "close": Decimal("10.0")},
        {"date": "2026-01-01", "high": Decimal("10.0"), "low": Decimal("8.0"), "close": Decimal("9.0")},
    ]
    bars = rows_to_bars(rows)
    assert bars["closes"] == [9.0, 10.0, 11.0]
    assert bars["highs"][0] == 10.0
    assert isinstance(bars["closes"][0], float)
