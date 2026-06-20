"""Pure technical-var math. No I/O. Hand-verifiable."""
from __future__ import annotations

import math

import numpy as np

MIN_BARS_X = 20


class InsufficientBars(Exception):
    """Raised when a factor cannot be computed from the given bar count."""


def compute_x_var(closes: list[float]) -> float:
    """X Var (vol factor): symmetric crowding x magnitude dispersion around
    the fitted regression centerline.

    X = (count_below * avg_dist_below) * (count_above * avg_dist_above)
    Returns 0.0 when all residuals sit on one side (degenerate dispersion).
    """
    n = len(closes)
    if n < MIN_BARS_X:
        raise InsufficientBars(f"need >= {MIN_BARS_X} closes, got {n}")
    x = np.arange(n, dtype=float)
    y = np.asarray(closes, dtype=float)
    if not np.isfinite(y).all():
        raise ValueError("closes contains NaN or Inf values")
    slope, intercept = np.polyfit(x, y, 1)
    resid = y - (slope * x + intercept)
    below = resid[resid < 0]
    above = resid[resid > 0]
    if below.size == 0 or above.size == 0:
        return 0.0
    avg_below = float(np.abs(below).mean())
    avg_above = float(np.abs(above).mean())
    result = (below.size * avg_below) * (above.size * avg_above)
    if not math.isfinite(result):
        raise ValueError("x_var overflow: outlier price data")
    return result


def compute_y_var(price: float, target: float, stop: float) -> float:
    """Y Var (risk/reward): distance-to-target / distance-to-stop.
    Returns 0.0 when risk is non-positive (no valid downside reference)."""
    risk = price - stop
    if risk <= 0:
        return 0.0
    return (target - price) / risk


MIN_BARS_Z = 30


def pivot_highs(highs: list[float], w: int = 5) -> list[tuple[int, float]]:
    """Local maxima: index i where highs[i] == max of the +/- w window.

    Assumes `highs` are raw stored OHLC values compared by value; for
    computed/derived highs a tolerance would be needed (exact float
    equality is unreliable for derived values).
    """
    out: list[tuple[int, float]] = []
    n = len(highs)
    for i in range(w, n - w):
        if highs[i] == max(highs[i - w : i + w + 1]):
            out.append((i, float(highs[i])))
    return out


def compute_z_var(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    atr: float,
    lookback: int = 252,
    tol_atr: float = 0.5,
) -> int:
    """Z Var (momentum): count of resistance levels that later flipped to
    support within the last `lookback` bars.

    A flip = a pivot-high level L that price (a) closed above by > tol band
    (breakout), then (b) returned so a bar low touched within tol of L while
    its close held at/above L (acted as support), with the support touch
    occurring inside the lookback window.
    """
    n = len(closes)
    if n < MIN_BARS_Z:
        raise InsufficientBars(f"need >= {MIN_BARS_Z} bars, got {n}")
    if atr <= 0:
        return 0
    band = tol_atr * atr
    window_start = max(0, n - lookback)
    flips = 0
    seen_levels: set[float] = set()
    for pidx, level in pivot_highs(highs, w=5):
        if pidx >= n - 10:
            continue
        level_key = round(level / band) * band
        if level_key in seen_levels:
            continue
        broke = False
        for j in range(pidx + 1, n):
            if not broke:
                if closes[j] > level + band:
                    broke = True
            else:
                touched_as_support = (
                    lows[j] <= level + band
                    and closes[j] >= level - band
                    and j >= window_start
                )
                if touched_as_support:
                    flips += 1
                    seen_levels.add(level_key)
                    break
    return flips
