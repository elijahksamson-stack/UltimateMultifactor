from app.analyze import analyze_bars


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
