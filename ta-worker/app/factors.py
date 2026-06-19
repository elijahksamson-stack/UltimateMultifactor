"""Pure technical-var math. No I/O. Hand-verifiable."""
from __future__ import annotations

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
    slope, intercept = np.polyfit(x, y, 1)
    resid = y - (slope * x + intercept)
    below = resid[resid < 0]
    above = resid[resid > 0]
    if below.size == 0 or above.size == 0:
        return 0.0
    avg_below = float(np.abs(below).mean())
    avg_above = float(above.mean())
    return (below.size * avg_below) * (above.size * avg_above)
