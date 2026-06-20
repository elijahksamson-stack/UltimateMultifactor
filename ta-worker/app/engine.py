"""Technical engine: ATR + stop/target derivation.
Clustering + vol-scaled stop/target adapted from Portfolio
backend/app/services/risk_reward_service.py."""
from __future__ import annotations

import numpy as np

from app.factors import pivot_highs

STOP_ATR_MULT = 1.0
TARGET_ATR_MULT = 1.0
NO_SUPPORT_ATR_MULT = 2.0
RR_TARGET = 2.0


def atr(
    highs: list[float], lows: list[float], closes: list[float], period: int = 14
) -> float:
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


def stop_and_target(
    price: float, atr_value: float, supports: list[float], resistances: list[float]
) -> dict:
    """Stop = nearest support below price padded by ATR; target = nearest
    resistance above price padded by ATR; both have fallbacks."""
    below = sorted([s for s in supports if s < price], reverse=True)
    above = sorted([r for r in resistances if r > price])

    stop = (
        below[0] - STOP_ATR_MULT * atr_value
        if below
        else price - NO_SUPPORT_ATR_MULT * atr_value
    )
    risk = price - stop
    target = (
        above[0] + TARGET_ATR_MULT * atr_value if above else price + RR_TARGET * risk
    )
    reward = target - price
    return {"stop": stop, "target": target, "risk": risk, "reward": reward}


def _pivot_lows(lows: list[float], w: int) -> list[float]:
    """Local minima: index i where lows[i] == min of the +/- w window.

    Assumes `lows` are raw stored OHLC values compared by exact value;
    derived/resampled lows would need a tolerance (exact float equality
    is unreliable for derived values).
    """
    out = []
    n = len(lows)
    for i in range(w, n - w):
        if lows[i] == min(lows[i - w : i + w + 1]):
            out.append(float(lows[i]))
    return out


def _cluster(levels: list[float], atr: float, mult: float = 0.75) -> list[float]:
    """Collapse nearby levels into cluster means (band = mult * atr)."""
    if not levels:
        return []
    band = max(mult * atr, 1e-9)
    ordered = sorted(levels)
    clusters: list[list[float]] = [[ordered[0]]]
    for lv in ordered[1:]:
        if lv - clusters[-1][0] <= band:
            clusters[-1].append(lv)
        else:
            clusters.append([lv])
    return [float(np.mean(c)) for c in clusters]


def support_resistance_levels(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    atr: float,
    price: float,
    w: int = 5,
) -> dict:
    """Cluster pivot highs above price (resistance) and pivot lows below price (support)."""
    res_raw = [lv for _, lv in pivot_highs(highs, w=w) if lv > price]
    sup_raw = [lv for lv in _pivot_lows(lows, w=w) if lv < price]
    return {"resistances": _cluster(res_raw, atr), "supports": _cluster(sup_raw, atr)}
