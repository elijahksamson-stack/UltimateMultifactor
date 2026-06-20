import pytest
from app.engine import atr as compute_atr, stop_and_target


def test_atr_constant_range():
    highs = [11.0] * 30
    lows = [9.0] * 30
    closes = [10.0] * 30
    assert compute_atr(highs, lows, closes, period=14) == pytest.approx(2.0, abs=1e-6)


def test_stop_and_target_uses_nearest_levels():
    res = stop_and_target(price=100.0, atr=2.0, supports=[95.0, 80.0], resistances=[110.0, 130.0])
    assert res["stop"] == pytest.approx(93.0)
    assert res["target"] == pytest.approx(112.0)
    assert res["risk"] == pytest.approx(7.0)
    assert res["reward"] == pytest.approx(12.0)


def test_stop_and_target_fallback_when_no_levels():
    res = stop_and_target(price=100.0, atr=2.0, supports=[], resistances=[])
    assert res["stop"] == pytest.approx(96.0)
    assert res["risk"] == pytest.approx(4.0)
    assert res["target"] == pytest.approx(108.0)
