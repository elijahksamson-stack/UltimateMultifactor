"""Technical engine: ATR + stop/target derivation.
Clustering + vol-scaled stop/target adapted from Portfolio
backend/app/services/risk_reward_service.py."""
from __future__ import annotations

import numpy as np

STOP_ATR_MULT = 1.0
TARGET_ATR_MULT = 1.0
NO_SUPPORT_ATR_MULT = 2.0
RR_TARGET = 2.0


def atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float:
    """Average True Range (simple mean of true ranges over `period`)."""
    n = len(closes)
    if n < 2:
        return 0.0
    trs = []
    for i in range(1, n):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    window = trs[-period:] if len(trs) >= period else trs
    return float(np.mean(window)) if window else 0.0


def stop_and_target(price: float, atr: float, supports: list[float], resistances: list[float]) -> dict:
    """Stop = nearest support below price padded by ATR; target = nearest
    resistance above price padded by ATR; both have fallbacks."""
    below = sorted([s for s in supports if s < price], reverse=True)
    above = sorted([r for r in resistances if r > price])

    stop = below[0] - STOP_ATR_MULT * atr if below else price - NO_SUPPORT_ATR_MULT * atr
    risk = price - stop
    target = above[0] + TARGET_ATR_MULT * atr if above else price + RR_TARGET * risk
    reward = target - price
    return {"stop": stop, "target": target, "risk": risk, "reward": reward}
