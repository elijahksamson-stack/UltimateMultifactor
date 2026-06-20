from __future__ import annotations

import math

from app import engine
from app.factors import (
    InsufficientBars,
    compute_x_var,
    compute_y_var,
    compute_z_var,
)
from app.schemas import TickerResult

MIN_BARS = 30


def analyze_bars(
    ticker: str,
    highs: list[float],
    lows: list[float],
    closes: list[float],
) -> TickerResult:
    """Compute X/Y/Z for one ticker. Never raises — failures land in
    TickerResult.error so one bad ticker can't fail a batch."""
    n = len(closes)
    if n < MIN_BARS:
        return TickerResult(ticker=ticker, error="insufficient_bars")
    if not all(math.isfinite(v) for seq in (highs, lows, closes) for v in seq):
        return TickerResult(ticker=ticker, error="non_finite_bars")
    try:
        price = closes[-1]
        a = engine.atr(highs, lows, closes)
        levels = engine.support_resistance_levels(highs, lows, closes, atr=a, price=price)
        st = engine.stop_and_target(price, a, levels["supports"], levels["resistances"])

        x_var = compute_x_var(closes)
        y_var = compute_y_var(price, st["target"], st["stop"])
        z_var = compute_z_var(highs, lows, closes, atr=a)
        return TickerResult(
            ticker=ticker,
            x_var=x_var,
            y_var=y_var,
            z_var=z_var,
            diagnostics={"bars": n, "atr": a, "price": price},
        )
    except InsufficientBars:
        return TickerResult(ticker=ticker, error="insufficient_bars")
    except Exception as exc:
        return TickerResult(ticker=ticker, error=f"compute_error:{type(exc).__name__}")
