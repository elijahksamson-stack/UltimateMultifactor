import pytest


@pytest.fixture
def trending_bars():
    """120 bars trending up with oscillation — enough for all three vars."""
    highs, lows, closes = [], [], []
    base = 50.0
    for i in range(120):
        c = base + i * 0.3 + (2.0 if i % 7 < 3 else -2.0)
        highs.append(c + 1.0)
        lows.append(c - 1.0)
        closes.append(c)
    return {"highs": highs, "lows": lows, "closes": closes}
