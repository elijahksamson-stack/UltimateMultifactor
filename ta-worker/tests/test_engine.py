import pytest

from app.engine import (
    atr as compute_atr,
    stop_and_target,
    support_resistance_levels,
    _cluster,
)
from app.config import Settings


def test_atr_constant_range():
    highs = [11.0] * 30
    lows = [9.0] * 30
    closes = [10.0] * 30
    assert compute_atr(highs, lows, closes, period=14) == pytest.approx(2.0, abs=1e-6)


def test_stop_and_target_uses_nearest_levels():
    res = stop_and_target(price=100.0, atr_value=2.0, supports=[95.0, 80.0], resistances=[110.0, 130.0])
    assert res["stop"] == pytest.approx(93.0)
    assert res["target"] == pytest.approx(112.0)
    assert res["risk"] == pytest.approx(7.0)
    assert res["reward"] == pytest.approx(12.0)


def test_stop_and_target_fallback_when_no_levels():
    res = stop_and_target(price=100.0, atr_value=2.0, supports=[], resistances=[])
    assert res["stop"] == pytest.approx(96.0)
    assert res["risk"] == pytest.approx(4.0)
    assert res["target"] == pytest.approx(108.0)


def test_support_resistance_splits_by_price():
    highs = [10, 12, 14, 12, 10, 12, 16, 12, 10, 12, 14, 12, 10, 12, 18, 12, 10]
    lows = [8, 7, 6, 7, 8, 7, 5, 7, 8, 7, 6, 7, 8, 7, 4, 7, 8]
    closes = [9] * len(highs)
    levels = support_resistance_levels(highs, lows, closes, atr=1.0, price=9.0, w=3)
    assert all(r > 9.0 for r in levels["resistances"])
    assert all(s < 9.0 for s in levels["supports"])
    assert len(levels["resistances"]) >= 1
    assert len(levels["supports"]) >= 1


def test_settings_reads_env(monkeypatch):
    monkeypatch.setenv("OTM_DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("TA_WORKER_SECRET", "s3cret")
    monkeypatch.setenv("TA_LOOKBACK_DAYS", "300")
    s = Settings()
    assert s.otm_database_url == "postgresql://x/y"
    assert s.ta_worker_secret == "s3cret"
    assert s.ta_lookback_days == 300


def test_cluster_does_not_chain_link():
    # band = 0.75*atr = 0.75; 100.0 and 101.1 are > 0.75 apart, must NOT merge
    levels = [100.0, 100.5, 101.1, 101.7]
    clusters = _cluster(levels, atr=1.0)
    assert len(clusters) == 2  # {100, 100.5} and {101.1, 101.7}
