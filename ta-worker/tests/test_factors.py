import pytest

from app.factors import (
    compute_x_var,
    compute_y_var,
    compute_z_var,
    pivot_highs,
    InsufficientBars,
)


def test_x_var_symmetric_dispersion_known_value():
    # palindromic +/-2 offsets => regression slope is exactly 0 => centerline flat at 10
    offs = [2, -2, 2, -2, 2, -2, 2, -2, 2, -2, -2, 2, -2, 2, -2, 2, -2, 2, -2, 2]
    closes = [10.0 + o for o in offs]
    # 10 below (|-2| avg 2.0), 10 above (avg 2.0) => (10*2)*(10*2) = 400
    assert compute_x_var(closes) == pytest.approx(400.0, abs=1e-6)


def test_x_var_flat_series_returns_zero():
    closes = [5.0] * 20  # zero residuals => below/above both empty => 0.0
    assert compute_x_var(closes) == 0.0


def test_x_var_raises_on_too_few_bars():
    with pytest.raises(InsufficientBars):
        compute_x_var([1.0, 2.0, 3.0])


def test_x_var_raises_on_non_finite():
    with pytest.raises(ValueError):
        compute_x_var([float("nan")] + [1.0] * 19)


def test_x_var_raises_on_overflow_output():
    closes = [1.0] * 29 + [1e200]  # finite inputs, but product overflows
    with pytest.raises(ValueError):
        compute_x_var(closes)


def test_y_var_basic_ratio():
    assert compute_y_var(price=100.0, target=110.0, stop=95.0) == pytest.approx(2.0)


def test_y_var_zero_or_negative_risk_returns_zero():
    assert compute_y_var(price=100.0, target=110.0, stop=100.0) == 0.0
    assert compute_y_var(price=100.0, target=110.0, stop=105.0) == 0.0


def test_y_var_negative_reward_allowed_as_negative():
    assert compute_y_var(price=100.0, target=98.0, stop=95.0) == pytest.approx(-0.4)


def test_pivot_highs_detects_local_maxima():
    highs = [1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0]
    piv = pivot_highs(highs, w=3)
    idxs = [i for i, _ in piv]
    assert 4 in idxs and 13 in idxs


def _flip_series():
    highs, lows, closes = [], [], []
    def push(c): highs.append(c + 0.5); lows.append(c - 0.5); closes.append(float(c))
    for c in [40,42,44,46,48,50,49,48,47,46,45,44,46,47,48]: push(c)
    for c in [47,46,45,45,46,45,44,45,46,45,46,47,48,49,50]: push(c)
    for c in [51,52,53,54,55,55,54,53,52,51]: push(c)
    for c in [50,50,50,51,52,51,50,51,52,53]: push(c)
    for c in [54,55,56,57,58,59,60,59,60,61]: push(c)
    return highs, lows, closes


def test_z_var_counts_one_flip():
    highs, lows, closes = _flip_series()
    assert compute_z_var(highs, lows, closes, atr=1.0, lookback=252, tol_atr=0.5) == 1


def test_z_var_no_flip_when_never_retested():
    closes = [float(c) for c in range(40, 100)]
    highs = [c + 0.5 for c in closes]
    lows = [c - 0.5 for c in closes]
    assert compute_z_var(highs, lows, closes, atr=1.0) == 0


def _double_top_series():
    highs, lows, closes = [], [], []
    def push(c): highs.append(c + 0.5); lows.append(c - 0.5); closes.append(float(c))
    for c in [40, 42, 44, 46, 48, 50, 48, 47, 48, 50, 48, 46, 45, 46, 47]: push(c)  # two peaks at 50 (double top)
    for c in [47, 46, 45, 45, 46, 45, 44, 45, 46, 45, 46, 47, 48, 49, 50]: push(c)
    for c in [51, 52, 53, 54, 55, 55, 54, 53, 52, 51]: push(c)                       # breakout
    for c in [50, 50, 50, 51, 52, 51, 50, 51, 52, 53]: push(c)                       # retest as support
    for c in [54, 55, 56, 57, 58, 59, 60, 59, 60, 61]: push(c)
    return highs, lows, closes


def test_z_var_double_top_counts_one_flip():
    highs, lows, closes = _double_top_series()
    assert compute_z_var(highs, lows, closes, atr=1.0) == 1
